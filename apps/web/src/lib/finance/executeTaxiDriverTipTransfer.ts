import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { appendWalletLedgerEntry } from "@/lib/payoutTransactionService";
import {
  buildDriverTipTransferIdempotencyKey,
  buildDriverTipTransferParams,
  driverTipShareCents,
} from "@/lib/finance/tipMoneyArchitecture";

type TipRideRow = {
  id: string;
  driver_id: string | null;
  status: string | null;
  currency: string | null;
  tip_cents: number | null;
  tip_paid_out: boolean | null;
  tip_transfer_id: string | null;
  tip_payment_intent_id: string | null;
  tip_stripe_charge_id: string | null;
  country_code: string | null;
};

export type ExecuteTaxiDriverTipTransferResult =
  | {
      ok: true;
      already_transferred: boolean;
      taxi_ride_id: string;
      transfer_id: string;
      amount_cents: number;
    }
  | { ok: false; error: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function chargeIdFromPaymentIntent(pi: {
  latest_charge?: unknown;
}): string | null {
  const charge = pi.latest_charge;
  if (isNonEmptyString(charge)) return charge.trim();
  if (charge && typeof charge === "object" && "id" in charge) {
    const id = (charge as { id?: unknown }).id;
    if (isNonEmptyString(id)) return id.trim();
  }
  return null;
}

/**
 * Execute SCT for a succeeded taxi tip PaymentIntent (100% to driver).
 */
export async function executeTaxiDriverTipTransfer(
  supabaseAdmin: SupabaseClient,
  params: {
    taxiRideId: string;
    paymentIntentId: string;
    paymentIntent?: Stripe.PaymentIntent | null;
  }
): Promise<ExecuteTaxiDriverTipTransferResult> {
  const taxiRideId = String(params.taxiRideId ?? "").trim();
  const paymentIntentId = String(params.paymentIntentId ?? "").trim();
  if (!taxiRideId) return { ok: false, error: "taxi_ride_id_required" };
  if (!paymentIntentId) return { ok: false, error: "payment_intent_required" };

  const { data: ride, error: rideErr } = await supabaseAdmin
    .from("taxi_rides")
    .select(
      "id,driver_id,status,currency,tip_cents,tip_paid_out,tip_transfer_id,tip_payment_intent_id,tip_stripe_charge_id,country_code"
    )
    .eq("id", taxiRideId)
    .maybeSingle();

  if (rideErr) return { ok: false, error: rideErr.message };
  if (!ride) return { ok: false, error: "taxi_ride_not_found" };

  const tipRide = ride as TipRideRow;

  if (tipRide.tip_paid_out && tipRide.tip_transfer_id) {
    return {
      ok: true,
      already_transferred: true,
      taxi_ride_id: taxiRideId,
      transfer_id: String(tipRide.tip_transfer_id),
      amount_cents: driverTipShareCents(Number(tipRide.tip_cents ?? 0)),
    };
  }

  if (!tipRide.driver_id) {
    return { ok: false, error: "driver_not_assigned" };
  }

  let chargeId = tipRide.tip_stripe_charge_id
    ? String(tipRide.tip_stripe_charge_id)
    : null;
  let tipCents = Math.max(0, Math.round(Number(tipRide.tip_cents ?? 0)));

  const pi =
    params.paymentIntent ??
    (await stripe.paymentIntents.retrieve(paymentIntentId));

  if (String(pi.status ?? "").toLowerCase() !== "succeeded") {
    return { ok: false, error: `payment_intent_status_${pi.status}` };
  }

  chargeId = chargeId ?? chargeIdFromPaymentIntent(pi);
  if (!chargeId) return { ok: false, error: "tip_charge_missing" };

  const mdAmount = Number(pi.metadata?.tip_cents ?? pi.amount ?? 0);
  if (tipCents <= 0 && Number.isFinite(mdAmount) && mdAmount > 0) {
    tipCents = Math.round(mdAmount);
  }
  if (tipCents <= 0) return { ok: false, error: "tip_cents_not_positive" };

  const { data: driver, error: driverErr } = await supabaseAdmin
    .from("driver_profiles")
    .select("user_id,stripe_account_id")
    .eq("user_id", tipRide.driver_id)
    .maybeSingle();

  if (driverErr) return { ok: false, error: driverErr.message };
  const destination = String(driver?.stripe_account_id ?? "").trim();
  if (!/^acct_[A-Za-z0-9]+$/.test(destination)) {
    return { ok: false, error: "driver_connect_not_ready" };
  }

  const currency = String(tipRide.currency ?? pi.currency ?? "usd");
  const transferParams = buildDriverTipTransferParams({
    tipCents,
    tipChargeId: chargeId,
    destinationAccountId: destination,
    currency,
    orderId: taxiRideId,
  });
  Object.assign(transferParams.metadata, {
    role: "taxi_driver_tip",
    taxi_ride_id: taxiRideId,
  });

  const transfer = await stripe.transfers.create(transferParams, {
    idempotencyKey: `${buildDriverTipTransferIdempotencyKey(taxiRideId)}_taxi`,
  });

  const now = new Date().toISOString();
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from("taxi_rides")
    .update({
      tip_cents: tipCents,
      tip_payment_intent_id: paymentIntentId,
      tip_stripe_charge_id: chargeId,
      tip_transfer_id: transfer.id,
      tip_paid_out: true,
      tip_paid_at: now,
      updated_at: now,
    })
    .eq("id", taxiRideId)
    .is("tip_transfer_id", null)
    .select("id")
    .maybeSingle();

  if (updateErr) {
    return { ok: false, error: updateErr.message };
  }
  if (!updated) {
    return {
      ok: true,
      already_transferred: true,
      taxi_ride_id: taxiRideId,
      transfer_id: transfer.id,
      amount_cents: tipCents,
    };
  }

  try {
    await appendWalletLedgerEntry(supabaseAdmin, {
      accountType: "driver",
      accountUserId: String(tipRide.driver_id),
      countryCode: String(tipRide.country_code ?? "US").toUpperCase(),
      currency: currency.toUpperCase(),
      direction: "credit",
      amountCents: tipCents,
      referenceType: "payment_transaction",
      referenceId: taxiRideId,
      description: `Taxi tip transfer ${transfer.id}`,
      metadata: {
        kind: "taxi_driver_tip",
        stripe_transfer_id: transfer.id,
        tip_charge_id: chargeId,
      },
    });
  } catch (e) {
    console.warn(
      "[executeTaxiDriverTipTransfer] wallet ledger write fail-open",
      e instanceof Error ? e.message : e
    );
  }

  return {
    ok: true,
    already_transferred: false,
    taxi_ride_id: taxiRideId,
    transfer_id: transfer.id,
    amount_cents: tipCents,
  };
}
