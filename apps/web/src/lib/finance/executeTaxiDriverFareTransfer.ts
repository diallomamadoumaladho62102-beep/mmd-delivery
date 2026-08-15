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

async function resolveSourceChargeId(
  stripeClient: Stripe,
  paymentIntentId: string,
): Promise<string | null> {
  const pi = await stripeClient.paymentIntents.retrieve(paymentIntentId);
  const charge = pi.latest_charge;
  if (typeof charge === "string" && charge.startsWith("ch_")) return charge;
  if (charge && typeof charge === "object" && "id" in charge) {
    return String(charge.id);
  }
  return null;
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

  // Stripe SoT: transfer id present = paid confirmed.
  if (String(commission.driver_transfer_id ?? "").trim()) {
    return {
      ok: true,
      already_succeeded: true,
      taxi_ride_id: rideId,
      transfer_id: String(commission.driver_transfer_id),
    };
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
      connectReady =
        account.charges_enabled === true && account.payouts_enabled === true;
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

  const idempotencyKey = `taxi_driver_payout:${rideId}`;
  const transferGroup = `taxi_ride:${rideId}`;

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
        },
      },
      { idempotencyKey },
    );
  } catch (e) {
    console.error("[executeTaxiDriverFareTransfer] transfer create failed", e);
    return {
      ok: false,
      error: "Stripe transfer failed",
      taxi_ride_id: rideId,
      httpStatus: 500,
    };
  }

  const nowIso = new Date().toISOString();
  // Paid only when transfer id is persisted (Stripe SoT).
  const { data: saved, error: saveErr } = await params.supabaseAdmin
    .from("taxi_commissions")
    .update({
      driver_transfer_id: transfer.id,
      driver_paid_out: true,
      driver_paid_out_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", commission.id)
    .is("driver_transfer_id", null)
    .select("id, driver_transfer_id")
    .maybeSingle();

  if (saveErr) {
    return {
      ok: false,
      error: "Transfer created but commission update failed",
      taxi_ride_id: rideId,
      httpStatus: 500,
    };
  }

  if (!saved) {
    const { data: current } = await params.supabaseAdmin
      .from("taxi_commissions")
      .select("driver_transfer_id")
      .eq("id", commission.id)
      .maybeSingle();
    const existing = String(current?.driver_transfer_id ?? "").trim();
    if (existing) {
      return {
        ok: true,
        already_succeeded: true,
        taxi_ride_id: rideId,
        transfer_id: existing,
      };
    }
    return {
      ok: false,
      error: "Transfer created but commission update raced",
      taxi_ride_id: rideId,
      httpStatus: 500,
    };
  }

  await logTaxiEventServer(params.supabaseAdmin, {
    rideId,
    eventType: "driver_payout",
    triggeredRole: "system",
    actorId: actor.startsWith("secret:") || actor.startsWith("cron:") || actor.startsWith("system:")
      ? null
      : actor,
    description: "Driver taxi fare Connect transfer",
    metadata: {
      transfer_id: transfer.id,
      amount,
      stripe_amount: stripeTransferAmount,
      currency,
      payment_intent_id: paymentIntentId,
      destination,
      actor,
    },
  });

  return {
    ok: true,
    dry_run: false,
    taxi_ride_id: rideId,
    transfer_id: transfer.id,
    amount,
    stripe_amount: stripeTransferAmount,
    currency,
    destination,
    source_charge_id: sourceChargeId,
    idempotency_key: idempotencyKey,
  };
}
