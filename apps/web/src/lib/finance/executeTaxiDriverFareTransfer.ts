/**
 * Platform → Driver Connect Transfer for taxi fares (SCT).
 * Call after ride completed + payment_status=paid. No destination charge.
 * Paid UI / SoT requires driver_transfer_id (set only after Stripe Transfer create).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import { assertTaxiPayoutCurrencyAllowed } from "@/lib/taxiCurrencyGuard";
import {
  assertTaxiLaunchFeature,
  fetchTaxiCountryLaunchConfig,
} from "@/lib/taxiLaunchControl";
import { assertPlatformFeature } from "@/lib/platformLaunchControl";
import { toStripeAmount } from "@/lib/taxiStripeAmounts";
import { normalizeTaxiCurrencyForStripe } from "@/lib/taxiCountries";
import { evaluateTaxiPayoutEligibility } from "@/lib/taxiPayoutEligibility";
import { stripe } from "@/lib/stripe";
import {
  buildTaxiFareTransferIdempotencyKey,
  isStripeTransferReversed,
  resolveTaxiFareTransferReusePlan,
  taxiFareTransferGroup,
} from "@/lib/finance/taxiFareTransferGuards";

export type ExecuteTaxiDriverFareTransferResult =
  | {
      ok: true;
      already_succeeded?: boolean;
      dry_run?: boolean;
      taxi_ride_id: string;
      transfer_id?: string;
      amount?: number;
      stripe_amount?: number;
      currency?: string;
      destination?: string;
      source_charge_id?: string;
      idempotency_key?: string;
    }
  | {
      ok: false;
      error: string;
      taxi_ride_id?: string;
      message?: string;
      country_code?: string;
      currency?: string;
      stripe_code?: string | null;
      stripe_type?: string | null;
      source_charge_id?: string;
      destination?: string;
      httpStatus?: number;
    };

type TaxiRideRow = {
  id: string;
  status: string | null;
  payment_status: string | null;
  refund_status: string | null;
  currency: string | null;
  country_code: string | null;
  driver_id: string | null;
  stripe_payment_intent_id: string | null;
  total_cents: number | null;
  completed_at: string | null;
  updated_at: string | null;
};

type TaxiCommissionRow = {
  id: string;
  taxi_ride_id: string;
  currency: string;
  driver_cents: number;
  driver_paid_out: boolean;
  driver_transfer_id: string | null;
  driver_paid_out_at: string | null;
};

function normalizeCurrency(v: unknown): string {
  return normalizeTaxiCurrencyForStripe(v, "usd");
}

/**
 * Stripe Charge id usable as Transfer `source_transaction`.
 * Card charges use `ch_…`; Link / some wallets surface as `py_…` (still a Charge object).
 * Rejecting `py_` blocked SCT for Link-paid taxi rides while card `ch_` succeeded.
 */
export async function resolveSourceChargeIdFromPaymentIntent(
  stripeClient: Stripe,
  paymentIntentId: string,
): Promise<string | null> {
  const pi = await stripeClient.paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge"],
  });
  const charge = pi.latest_charge;
  if (typeof charge === "string") {
    const id = charge.trim();
    if (id.startsWith("ch_") || id.startsWith("py_")) return id;
    return null;
  }
  if (charge && typeof charge === "object" && "id" in charge) {
    const id = String((charge as { id?: unknown }).id ?? "").trim();
    if (id.startsWith("ch_") || id.startsWith("py_")) return id;
  }
  return null;
}

async function resolveSourceChargeId(
  stripeClient: Stripe,
  paymentIntentId: string,
): Promise<string | null> {
  return resolveSourceChargeIdFromPaymentIntent(stripeClient, paymentIntentId);
}

function holdHoursMs(): number {
  // Default 0: immediate SCT after complete (bank payout = Sunday 04:00 ET cron).
  const holdHours = Number(process.env.TAXI_PAYOUT_HOLD_HOURS ?? 0);
  return Number.isFinite(holdHours) && holdHours >= 0
    ? holdHours * 60 * 60 * 1000
    : 0;
}

export async function executeTaxiDriverFareTransfer(params: {
  supabaseAdmin: SupabaseClient;
  taxiRideId: string;
  dryRun?: boolean;
  actor?: string | null;
}): Promise<ExecuteTaxiDriverFareTransferResult> {
  const rideId = String(params.taxiRideId ?? "").trim();
  const dryRun = params.dryRun === true;
  const actor = params.actor ?? "system:taxi_fare_transfer";

  if (!rideId) {
    return { ok: false, error: "taxi_ride_id required", httpStatus: 400 };
  }

  const { data: ride, error: rideErr } = await params.supabaseAdmin
    .from("taxi_rides")
    .select(
      "id, status, payment_status, refund_status, currency, country_code, driver_id, stripe_payment_intent_id, total_cents, completed_at, updated_at",
    )
    .eq("id", rideId)
    .maybeSingle<TaxiRideRow>();

  if (rideErr || !ride) {
    return { ok: false, error: "Taxi ride not found", httpStatus: 404 };
  }

  let { data: commission, error: comErr } = await params.supabaseAdmin
    .from("taxi_commissions")
    .select(
      "id, taxi_ride_id, currency, driver_cents, driver_paid_out, driver_transfer_id, driver_paid_out_at",
    )
    .eq("taxi_ride_id", rideId)
    .maybeSingle<TaxiCommissionRow>();

  if (comErr) {
    return { ok: false, error: "Taxi commission lookup failed", httpStatus: 500 };
  }

  if (!commission) {
    const { error: refreshErr } = await params.supabaseAdmin.rpc(
      "refresh_taxi_commissions",
      { p_ride_id: rideId },
    );
    if (refreshErr) {
      return {
        ok: false,
        error: "Failed to refresh taxi commissions",
        httpStatus: 500,
      };
    }
    const reload = await params.supabaseAdmin
      .from("taxi_commissions")
      .select(
        "id, taxi_ride_id, currency, driver_cents, driver_paid_out, driver_transfer_id, driver_paid_out_at",
      )
      .eq("taxi_ride_id", rideId)
      .maybeSingle<TaxiCommissionRow>();
    commission = reload.data ?? null;
    if (reload.error) {
      return {
        ok: false,
        error: "Taxi commission lookup failed after refresh",
        httpStatus: 500,
      };
    }
  }

  if (!commission) {
    return { ok: false, error: "Taxi commission missing", httpStatus: 409 };
  }

  // Stripe SoT: transfer id present usually means paid — but re-check Stripe so a
  // reversed Transfer never stays "paid" while waiting for (or missing) the webhook.
  const existingTransferId = String(commission.driver_transfer_id ?? "").trim();
  if (existingTransferId) {
    try {
      const existingTransfer = await stripe.transfers.retrieve(existingTransferId);
      if (isStripeTransferReversed(existingTransfer)) {
        const nowIso = new Date().toISOString();
        await params.supabaseAdmin
          .from("taxi_commissions")
          .update({
            driver_paid_out: false,
            driver_paid_out_at: null,
            driver_transfer_id: null,
            updated_at: nowIso,
          })
          .eq("id", commission.id)
          .eq("driver_transfer_id", existingTransferId);
        commission = {
          ...commission,
          driver_paid_out: false,
          driver_paid_out_at: null,
          driver_transfer_id: null,
        };
      } else {
        return {
          ok: true,
          already_succeeded: true,
          taxi_ride_id: rideId,
          transfer_id: existingTransferId,
        };
      }
    } catch (e) {
      // Fail closed on Stripe lookup errors: do not invent a new Transfer while an
      // id is still claimed locally (webhook/retry can heal after reverse clear).
      console.error(
        "[executeTaxiDriverFareTransfer] existing transfer retrieve failed",
        { rideId, transfer_id: existingTransferId, error: e },
      );
      return {
        ok: true,
        already_succeeded: true,
        taxi_ride_id: rideId,
        transfer_id: existingTransferId,
      };
    }
  }

  // Repair stale lock: paid_out without transfer id must not block retry.
  if (commission.driver_paid_out && !commission.driver_transfer_id) {
    await params.supabaseAdmin
      .from("taxi_commissions")
      .update({
        driver_paid_out: false,
        driver_paid_out_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", commission.id)
      .is("driver_transfer_id", null);
    commission = { ...commission, driver_paid_out: false, driver_paid_out_at: null };
  }

  const amount = Math.round(Number(commission.driver_cents ?? 0));

  let destination = "";
  if (ride.driver_id) {
    const { data: features } = await params.supabaseAdmin
      .from("taxi_driver_features")
      .select("stripe_connect_account_id")
      .eq("user_id", ride.driver_id)
      .maybeSingle<{ stripe_connect_account_id: string | null }>();

    destination = String(features?.stripe_connect_account_id ?? "").trim();

    if (!destination) {
      const { data: driverProfile } = await params.supabaseAdmin
        .from("driver_profiles")
        .select("stripe_account_id")
        .eq("user_id", ride.driver_id)
        .maybeSingle<{ stripe_account_id: string | null }>();

      destination = String(driverProfile?.stripe_account_id ?? "").trim();
    }
  }

  let connectReady: boolean | null = null;
  if (destination) {
    try {
      const account = await stripe.accounts.retrieve(destination);
      // SCT needs transfers capability; bank payouts_enabled is separate (Sunday cron).
      const transfersCap = String(account.capabilities?.transfers ?? "");
      connectReady =
        transfersCap === "active" ||
        (account.charges_enabled === true && account.payouts_enabled === true);
    } catch {
      connectReady = false;
    }
  } else {
    connectReady = false;
  }

  const eligibility = evaluateTaxiPayoutEligibility({
    rideStatus: ride.status,
    paymentStatus: ride.payment_status,
    refundStatus: ride.refund_status,
    driverId: ride.driver_id,
    driverCents: amount,
    driverPaidOut: false,
    driverTransferId: commission.driver_transfer_id,
    completedAt: ride.completed_at ?? ride.updated_at,
    holdUntilMs: holdHoursMs(),
    connectReady,
  });

  if (eligibility.ok === false) {
    const reason = eligibility.reason;
    const httpStatus =
      reason === "connect_not_ready" || reason === "missing_driver" ? 400 : 409;
    return { ok: false, error: reason, taxi_ride_id: rideId, httpStatus };
  }

  if (eligibility.alreadyPaid) {
    return {
      ok: true,
      already_succeeded: true,
      taxi_ride_id: rideId,
      transfer_id: String(commission.driver_transfer_id ?? ""),
    };
  }

  if (!destination) {
    return {
      ok: false,
      error: "Driver payout account missing",
      taxi_ride_id: rideId,
      httpStatus: 400,
    };
  }

  if (!/^acct_[A-Za-z0-9]+$/.test(destination)) {
    return {
      ok: false,
      error: "invalid_connect_account_id",
      taxi_ride_id: rideId,
      httpStatus: 400,
    };
  }

  const paymentIntentId = String(ride.stripe_payment_intent_id ?? "").trim();
  if (!paymentIntentId) {
    return {
      ok: false,
      error: "Missing stripe payment intent",
      taxi_ride_id: rideId,
      httpStatus: 409,
    };
  }

  const sourceChargeId = await resolveSourceChargeId(stripe, paymentIntentId);
  if (!sourceChargeId) {
    return {
      ok: false,
      error: "Missing source charge for transfer",
      taxi_ride_id: rideId,
      httpStatus: 409,
    };
  }

  const currency = normalizeCurrency(ride.currency || commission.currency);

  const launchConfig = await fetchTaxiCountryLaunchConfig(
    params.supabaseAdmin,
    String(ride.country_code ?? ""),
  );
  if (launchConfig) {
    const payoutLaunch = assertTaxiLaunchFeature(launchConfig, "payout");
    if (payoutLaunch.ok === false) {
      return {
        ok: false,
        error: payoutLaunch.error,
        message: payoutLaunch.message,
        country_code: launchConfig.country_code,
        httpStatus: 400,
      };
    }
  }

  const platformPayout = await assertPlatformFeature(
    params.supabaseAdmin,
    String(ride.country_code ?? ""),
    "taxi",
    "payout",
  );
  if (platformPayout.ok === false) {
    return {
      ok: false,
      error: platformPayout.error,
      message: platformPayout.message,
      country_code: platformPayout.country_code,
      httpStatus: 400,
    };
  }

  const payoutCurrency = assertTaxiPayoutCurrencyAllowed(currency);
  if (payoutCurrency.ok === false) {
    return {
      ok: false,
      error: payoutCurrency.error,
      message: payoutCurrency.message,
      currency: payoutCurrency.currency,
      httpStatus: 400,
    };
  }

  const stripeTransferAmount = toStripeAmount(currency, amount);
  if (stripeTransferAmount <= 0) {
    return {
      ok: false,
      error: "Driver payout amount invalid for Stripe",
      httpStatus: 409,
    };
  }

  const transferGroup = taxiFareTransferGroup(rideId);

  // Reconcile against Stripe before create: reuse active Transfer; after reverse,
  // mint a new idempotency key so Stripe cannot return the reversed object.
  let afterReversedTransferId: string | null = null;
  try {
    const listed = await stripe.transfers.list({
      transfer_group: transferGroup,
      limit: 100,
    });
    const plan = resolveTaxiFareTransferReusePlan(listed.data ?? []);
    if (plan.reusableTransferId) {
      if (dryRun) {
        return {
          ok: true,
          dry_run: true,
          already_succeeded: true,
          taxi_ride_id: rideId,
          transfer_id: plan.reusableTransferId,
          amount,
          stripe_amount: stripeTransferAmount,
          currency,
          destination,
          source_charge_id: sourceChargeId,
          idempotency_key: buildTaxiFareTransferIdempotencyKey(rideId, null),
        };
      }
      const persisted = await persistTaxiFareTransferId({
        supabaseAdmin: params.supabaseAdmin,
        commissionId: commission.id,
        transferId: plan.reusableTransferId,
        rideId,
        actor,
        amount,
        stripeTransferAmount,
        currency,
        paymentIntentId,
        destination,
        alreadySucceeded: true,
      });
      if (persisted.ok) {
        return {
          ...persisted,
          amount,
          stripe_amount: stripeTransferAmount,
          currency,
          destination,
          source_charge_id: sourceChargeId,
          idempotency_key: buildTaxiFareTransferIdempotencyKey(rideId, null),
        };
      }
      return persisted;
    }
    afterReversedTransferId = plan.afterReversedTransferId;
  } catch (e) {
    console.error(
      "[executeTaxiDriverFareTransfer] transfer list failed; continuing with keyed create",
      e,
    );
  }

  const idempotencyKey = buildTaxiFareTransferIdempotencyKey(
    rideId,
    afterReversedTransferId,
  );

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      taxi_ride_id: rideId,
      amount,
      stripe_amount: stripeTransferAmount,
      currency,
      destination,
      source_charge_id: sourceChargeId,
      idempotency_key: idempotencyKey,
    };
  }

  let transfer: Stripe.Transfer;
  try {
    transfer = await stripe.transfers.create(
      {
        amount: stripeTransferAmount,
        currency,
        destination,
        transfer_group: transferGroup,
        source_transaction: sourceChargeId,
        metadata: {
          module: "taxi",
          taxi_ride_id: rideId,
          taxi_commission_id: commission.id,
          driver_id: String(ride.driver_id ?? ""),
          amount_cents: String(amount),
          payment_intent_id: paymentIntentId,
          ...(afterReversedTransferId
            ? { after_reversed_transfer_id: afterReversedTransferId }
            : {}),
        },
      },
      { idempotencyKey },
    );
  } catch (e) {
    const stripeErr = e as {
      message?: string;
      code?: string;
      type?: string;
      raw?: { message?: string; code?: string };
    };
    const stripeMessage = String(
      stripeErr?.raw?.message ?? stripeErr?.message ?? e,
    ).slice(0, 500);
    const stripeCode = String(
      stripeErr?.code ?? stripeErr?.raw?.code ?? "",
    )
      .trim()
      .toLowerCase();

    // Old charges whose funds already left platform (bank payout) cannot use
    // source_transaction. Fall back once to available platform balance when
    // Stripe reports insufficient funds — never invent money; still idempotent.
    const balanceRelated =
      stripeCode.includes("insufficient") ||
      stripeMessage.toLowerCase().includes("insufficient") ||
      stripeCode === "balance_insufficient";

    if (balanceRelated) {
      try {
        const bal = await stripe.balance.retrieve();
        const available = (bal.available ?? [])
          .filter((b) => String(b.currency).toLowerCase() === currency)
          .reduce((s, b) => s + Number(b.amount ?? 0), 0);
        if (available >= stripeTransferAmount) {
          const fallbackKey = `${idempotencyKey}:from_available`;
          transfer = await stripe.transfers.create(
            {
              amount: stripeTransferAmount,
              currency,
              destination,
              transfer_group: transferGroup,
              metadata: {
                module: "taxi",
                taxi_ride_id: rideId,
                taxi_commission_id: commission.id,
                driver_id: String(ride.driver_id ?? ""),
                amount_cents: String(amount),
                payment_intent_id: paymentIntentId,
                source_transaction_fallback: "platform_available",
                original_source_charge_id: sourceChargeId,
                original_stripe_code: stripeCode,
              },
            },
            { idempotencyKey: fallbackKey },
          );
        } else {
          console.error(
            "[executeTaxiDriverFareTransfer] transfer create failed",
            {
              rideId,
              sourceChargeId,
              destination,
              amount: stripeTransferAmount,
              currency,
              stripeCode,
              stripeMessage,
              platform_available: available,
            },
          );
          return {
            ok: false,
            error: "Stripe transfer failed",
            message: `${stripeMessage} (platform_available_${currency}=${available})`,
            stripe_code: stripeCode || null,
            stripe_type: stripeErr?.type ?? null,
            taxi_ride_id: rideId,
            source_charge_id: sourceChargeId,
            destination,
            httpStatus: 500,
          };
        }
      } catch (e2) {
        const err2 = e2 as {
          message?: string;
          code?: string;
          type?: string;
          raw?: { message?: string; code?: string };
        };
        const msg2 = String(err2?.raw?.message ?? err2?.message ?? e2).slice(
          0,
          500,
        );
        const code2 = String(err2?.code ?? err2?.raw?.code ?? "").trim();
        console.error(
          "[executeTaxiDriverFareTransfer] available-balance fallback failed",
          { rideId, stripeCode, stripeMessage, msg2 },
        );
        return {
          ok: false,
          error: "Stripe transfer failed",
          message: msg2 || stripeMessage,
          stripe_code: code2 || stripeCode || null,
          stripe_type: err2?.type ?? stripeErr?.type ?? null,
          taxi_ride_id: rideId,
          source_charge_id: sourceChargeId,
          destination,
          httpStatus: 500,
        };
      }
    } else {
      console.error("[executeTaxiDriverFareTransfer] transfer create failed", {
        rideId,
        sourceChargeId,
        destination,
        amount: stripeTransferAmount,
        currency,
        stripeCode,
        stripeMessage,
      });
      return {
        ok: false,
        error: "Stripe transfer failed",
        message: stripeMessage,
        stripe_code: stripeCode || null,
        stripe_type: stripeErr?.type ?? null,
        taxi_ride_id: rideId,
        source_charge_id: sourceChargeId,
        destination,
        httpStatus: 500,
      };
    }
  }

  // Never credit Wallet / mark paid for a reversed Transfer (idempotency replay).
  if (isStripeTransferReversed(transfer)) {
    console.error(
      "[executeTaxiDriverFareTransfer] refused reversed transfer",
      {
        rideId,
        transfer_id: transfer.id,
        idempotency_key: idempotencyKey,
      },
    );
    return {
      ok: false,
      error: "stripe_transfer_reversed",
      taxi_ride_id: rideId,
      message:
        "Stripe returned a reversed Transfer; refusing to mark payout paid",
      httpStatus: 409,
    };
  }

  const persisted = await persistTaxiFareTransferId({
    supabaseAdmin: params.supabaseAdmin,
    commissionId: commission.id,
    transferId: transfer.id,
    rideId,
    actor,
    amount,
    stripeTransferAmount,
    currency,
    paymentIntentId,
    destination,
    alreadySucceeded: false,
  });

  if (!persisted.ok) return persisted;

  return {
    ...persisted,
    amount,
    stripe_amount: stripeTransferAmount,
    currency,
    destination,
    source_charge_id: sourceChargeId,
    idempotency_key: idempotencyKey,
  };
}

async function persistTaxiFareTransferId(params: {
  supabaseAdmin: SupabaseClient;
  commissionId: string;
  transferId: string;
  rideId: string;
  actor: string;
  amount: number;
  stripeTransferAmount: number;
  currency: string;
  paymentIntentId: string;
  destination: string;
  alreadySucceeded: boolean;
}): Promise<ExecuteTaxiDriverFareTransferResult> {
  const transferId = String(params.transferId ?? "").trim();
  if (!transferId) {
    return {
      ok: false,
      error: "Missing transfer id",
      taxi_ride_id: params.rideId,
      httpStatus: 500,
    };
  }

  const nowIso = new Date().toISOString();
  // Paid only when a non-reversed transfer id is persisted (Stripe SoT).
  const { data: saved, error: saveErr } = await params.supabaseAdmin
    .from("taxi_commissions")
    .update({
      driver_transfer_id: transferId,
      driver_paid_out: true,
      driver_paid_out_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", params.commissionId)
    .is("driver_transfer_id", null)
    .select("id, driver_transfer_id")
    .maybeSingle();

  if (saveErr) {
    return {
      ok: false,
      error: "Transfer created but commission update failed",
      taxi_ride_id: params.rideId,
      httpStatus: 500,
    };
  }

  if (!saved) {
    const { data: current } = await params.supabaseAdmin
      .from("taxi_commissions")
      .select("driver_transfer_id")
      .eq("id", params.commissionId)
      .maybeSingle();
    const existing = String(current?.driver_transfer_id ?? "").trim();
    if (existing) {
      return {
        ok: true,
        already_succeeded: true,
        taxi_ride_id: params.rideId,
        transfer_id: existing,
      };
    }
    return {
      ok: false,
      error: "Transfer created but commission update raced",
      taxi_ride_id: params.rideId,
      httpStatus: 500,
    };
  }

  if (!params.alreadySucceeded) {
    await logTaxiEventServer(params.supabaseAdmin, {
      rideId: params.rideId,
      eventType: "driver_payout",
      triggeredRole: "system",
      actorId:
        params.actor.startsWith("secret:") ||
        params.actor.startsWith("cron:") ||
        params.actor.startsWith("system:")
          ? null
          : params.actor,
      description: "Driver taxi fare Connect transfer",
      metadata: {
        transfer_id: transferId,
        amount: params.amount,
        stripe_amount: params.stripeTransferAmount,
        currency: params.currency,
        payment_intent_id: params.paymentIntentId,
        destination: params.destination,
        actor: params.actor,
      },
    });
  }

  return {
    ok: true,
    already_succeeded: params.alreadySucceeded,
    dry_run: false,
    taxi_ride_id: params.rideId,
    transfer_id: transferId,
  };
}
