import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import { getDispatchSiteOrigin } from "@/lib/scheduleDeliveryRequestDispatch";
import { scheduleTaxiRideDispatchIfEligible } from "@/lib/taxiSharedRideDispatch";

type TaxiRidePaymentRow = {
  id: string;
  payment_status: string | null;
  status: string | null;
  total_cents: number | null;
  currency: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  client_user_id: string | null;
  preferred_driver_id?: string | null;
  is_scheduled?: boolean | null;
};

export function isTaxiStripeModule(
  md: Record<string, unknown> | null | undefined
): boolean {
  return String(md?.module ?? "").trim().toLowerCase() === "taxi";
}

export function pickTaxiRideIdFromMetadata(
  md: Record<string, unknown> | null | undefined
): string | null {
  if (!isTaxiStripeModule(md)) return null;

  const raw = md?.taxiRideId ?? md?.taxi_ride_id ?? md?.ride_id ?? null;
  if (!raw) return null;

  const normalized = String(raw).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeCurrency(value: unknown): string {
  return String(value ?? "usd").trim().toLowerCase() || "usd";
}

function toPositiveNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function resolveTaxiRideAmountCents(ride: TaxiRidePaymentRow): number | null {
  return toPositiveNumber(ride.total_cents);
}

function paymentIntentIdFromUnknown(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && "id" in value) {
    const maybeId = (value as { id?: unknown }).id;
    if (typeof maybeId === "string" && maybeId.trim()) return maybeId.trim();
  }
  return null;
}

export async function markTaxiRidePaidRobustly(
  supabaseAdmin: SupabaseClient,
  params: {
    taxiRideId: string;
    sessionId?: string | null;
    paymentIntentId?: string | null;
  }
): Promise<
  | { ok: true; via: "rpc"; data: unknown; already_paid?: boolean }
  | { ok: false; error: string }
> {
  const { data, error } = await supabaseAdmin.rpc("mark_taxi_ride_paid", {
    p_ride_id: params.taxiRideId,
    p_session_id: params.sessionId ?? null,
    p_payment_intent_id: params.paymentIntentId ?? null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const result = (data ?? {}) as {
    ok?: boolean;
    already?: boolean;
    idempotent?: boolean;
    message?: string;
  };

  if (result.ok === false) {
    return { ok: false, error: String(result.message ?? "mark_taxi_ride_paid_failed") };
  }

  const alreadyPaid = result.already === true || result.idempotent === true;

  return {
    ok: true,
    via: "rpc",
    data,
    already_paid: alreadyPaid,
  };
}

export async function handleTaxiStripePayment(params: {
  supabaseAdmin: SupabaseClient;
  taxiRideId: string;
  sessionId?: string | null;
  paymentIntentId?: string | null;
  expectedAmountCents?: number | null;
  expectedCurrency?: string | null;
  source: string;
}): Promise<{ ok: boolean; already_paid?: boolean; error?: string }> {
  const { supabaseAdmin, taxiRideId, sessionId, paymentIntentId, source } = params;

  const { data: ride, error: rideError } = await supabaseAdmin
    .from("taxi_rides")
    .select(
      "id,payment_status,status,total_cents,currency,stripe_session_id,stripe_payment_intent_id,client_user_id,preferred_driver_id,is_scheduled"
    )
    .eq("id", taxiRideId)
    .maybeSingle();

  if (rideError) {
    return { ok: false, error: rideError.message };
  }

  if (!ride) {
    return { ok: false, error: "taxi_ride_not_found" };
  }

  const row = ride as TaxiRidePaymentRow;

  if (
    row.stripe_session_id &&
    sessionId &&
    row.stripe_session_id !== sessionId
  ) {
    return { ok: false, error: "session_id_mismatch" };
  }

  if (
    row.stripe_payment_intent_id &&
    paymentIntentId &&
    row.stripe_payment_intent_id !== paymentIntentId
  ) {
    return { ok: false, error: "payment_intent_mismatch" };
  }

  const rideAmountCents = resolveTaxiRideAmountCents(row);
  if (!rideAmountCents) {
    return { ok: false, error: "missing_expected_amount" };
  }

  const stripeAmountCents = toPositiveNumber(params.expectedAmountCents);
  if (!stripeAmountCents) {
    return { ok: false, error: "missing_stripe_amount" };
  }

  if (stripeAmountCents !== rideAmountCents) {
    return { ok: false, error: "amount_mismatch" };
  }

  const rideCurrency = normalizeCurrency(row.currency);
  const stripeCurrency = normalizeCurrency(params.expectedCurrency);
  if (stripeCurrency !== rideCurrency) {
    return { ok: false, error: "currency_mismatch" };
  }

  const markResult = await markTaxiRidePaidRobustly(supabaseAdmin, {
    taxiRideId,
    sessionId,
    paymentIntentId,
  });

  if (markResult.ok === false) {
    return { ok: false, error: markResult.error };
  }

  if (markResult.already_paid) {
    console.log("[handleTaxiStripePayment] idempotent skip", {
      taxiRideId,
      source,
    });
    return { ok: true, already_paid: true };
  }

  await logTaxiEventServer(supabaseAdmin, {
    rideId: taxiRideId,
    eventType: "ride_paid_webhook",
    oldStatus: row.status,
    newStatus: "paid",
    triggeredRole: "system",
    description: "Taxi ride marked paid from Stripe webhook",
    metadata: {
      source,
      session_id: sessionId,
      payment_intent_id: paymentIntentId,
      expected_amount_cents: rideAmountCents,
      actual_amount_cents: stripeAmountCents,
      expected_currency: rideCurrency,
    },
  });

  const dispatchOrigin = getDispatchSiteOrigin();
  if (dispatchOrigin) {
    await scheduleTaxiRideDispatchIfEligible({
      supabase: supabaseAdmin,
      origin: dispatchOrigin,
      taxiRideId,
      rideForWave: row,
    });
  }

  return { ok: true, already_paid: false };
}

export function getStripeAmountFromCheckoutSession(session: Stripe.Checkout.Session): number | null {
  if (Number.isFinite(session.amount_total) && session.amount_total! > 0) {
    return Math.round(session.amount_total!);
  }
  return null;
}

export function getStripeAmountFromPaymentIntent(pi: Stripe.PaymentIntent): number | null {
  if (Number.isFinite(pi.amount) && pi.amount > 0) {
    return Math.round(pi.amount);
  }
  return null;
}

export { paymentIntentIdFromUnknown };
