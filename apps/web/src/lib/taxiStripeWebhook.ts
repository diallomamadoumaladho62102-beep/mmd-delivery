import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import { getDispatchSiteOrigin } from "@/lib/scheduleDeliveryRequestDispatch";
import { scheduleTaxiRideDispatchIfEligible } from "@/lib/taxiSharedRideDispatch";
import {
  fromStripeAmount,
  normalizeTaxiCurrencyUpper,
} from "@/lib/taxiStripeAmounts";
import { bridgeStripeWalletFromPaidTaxiRide } from "@/lib/stripeInboundWalletBridge";
import {
  requirePaymentIntentSucceeded,
  assertSettlementMatchesExpectation,
} from "@/lib/requirePaymentIntentSucceeded";
import { captureEntityCredit, releaseEntityCredit } from "@/lib/loyalty/loyaltyCredit";

type TaxiRidePaymentRow = {
  id: string;
  payment_status: string | null;
  status: string | null;
  total_cents: number | null;
  currency: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  client_user_id: string | null;
  created_by?: string | null;
  country_code?: string | null;
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
  return normalizeTaxiCurrencyUpper(value, "USD").toLowerCase();
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
  // When the caller already holds a succeeded PaymentIntent object (e.g. the
  // payment_intent.succeeded event), pass it to avoid a redundant Stripe fetch.
  paymentIntent?: Stripe.PaymentIntent | null;
  // Stripe metadata (from the session or PaymentIntent) so we can assert the
  // settled money belongs to THIS ride's owner and service before marking paid.
  metadata?: Record<string, unknown> | null;
}): Promise<{ ok: boolean; already_paid?: boolean; error?: string }> {
  const { supabaseAdmin, taxiRideId, sessionId, source } = params;
  let paymentIntentId = params.paymentIntentId ?? null;

  const { data: ride, error: rideError } = await supabaseAdmin
    .from("taxi_rides")
    .select(
      "id,payment_status,status,total_cents,currency,stripe_session_id,stripe_payment_intent_id,client_user_id,preferred_driver_id,is_scheduled,country_code,created_by"
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

  const stripeAmountCents = toPositiveNumber(params.expectedAmountCents);
  if (!stripeAmountCents) {
    return { ok: false, error: "missing_stripe_amount" };
  }

  const rideAmountCents = resolveTaxiRideAmountCents(row);
  if (!rideAmountCents) {
    return { ok: false, error: "missing_expected_amount" };
  }

  const rideCurrency = normalizeTaxiCurrencyUpper(row.currency);
  const convertedStripeCents = fromStripeAmount(rideCurrency, stripeAmountCents);

  if (convertedStripeCents !== rideAmountCents) {
    return { ok: false, error: "amount_mismatch" };
  }

  const stripeCurrency = normalizeCurrency(params.expectedCurrency);
  if (stripeCurrency !== normalizeCurrency(row.currency)) {
    return { ok: false, error: "currency_mismatch" };
  }

  const paymentAlreadyRecorded =
    String(row.payment_status ?? "").trim().toLowerCase() === "paid";

  // Idempotent replay: ride already paid. Keep the (idempotent) wallet bridge
  // but do not re-run Stripe verification or re-flip status. Still heal finance
  // (idempotent taxi_paid) in case an earlier confirm marked paid without enqueue.
  if (paymentAlreadyRecorded) {
    if (paymentIntentId) {
      const walletBridge = await bridgeStripeWalletFromPaidTaxiRide(supabaseAdmin, {
        paymentIntentId,
        taxiRide: row,
        source: `${source}:already_paid`,
      });
      if (walletBridge.ok === false) {
        return { ok: false, error: walletBridge.error };
      }
    }
    try {
      const { enqueueTaxiPaidFailOpen } = await import(
        "@/lib/finance/financeEvents"
      );
      await enqueueTaxiPaidFailOpen({
        supabaseAdmin,
        taxiRideId,
        amountCents: rideAmountCents ?? Number(row.total_cents ?? 0),
        currency: row.currency,
        countryCode: row.country_code ?? null,
        paymentIntentId,
      });
    } catch (e) {
      console.warn(
        "[finance] taxi already_paid taxi_paid enqueue fail-open",
        e instanceof Error ? e.message : e
      );
    }
    console.log("[handleTaxiStripePayment] idempotent skip", {
      taxiRideId,
      source,
    });
    return { ok: true, already_paid: true };
  }

  // Platform rule (single source of truth): before flipping a ride to paid we
  // ALWAYS require the underlying PaymentIntent to have actually succeeded.
  // A checkout session's payment_status is never trusted on its own — even when
  // the webhook event carries no PI id (resolve via sessionId). Skipping this
  // when PI was missing previously allowed session-only settlement.
  const settled = await requirePaymentIntentSucceeded({
    paymentIntentId: paymentIntentId ?? null,
    sessionId: sessionId ?? row.stripe_session_id ?? null,
    paymentIntent: params.paymentIntent ?? null,
  });
  if (!settled.ok) {
    return { ok: false, error: `payment_intent_not_succeeded:${settled.reason}` };
  }
  if (settled.payment_intent_id) {
    paymentIntentId = settled.payment_intent_id;
  }

  // Ownership + service guard (verify-if-present): reject a succeeded PI whose
  // metadata says it belongs to another user or a non-taxi service. Amount and
  // currency are already validated above with taxi minor-unit conversion, so
  // they are intentionally not re-checked here. Missing metadata is tolerated
  // (legacy PIs) — only a positive mismatch blocks the transition to paid.
  const metadata =
    params.metadata ??
    settled.metadata ??
    (params.paymentIntent?.metadata as Record<string, unknown> | undefined) ??
    null;
  const expectation = assertSettlementMatchesExpectation(settled, metadata, {
    userId: row.client_user_id ?? null,
    serviceType: "taxi",
    entityId: taxiRideId,
    entityIdKeys: ["taxi_ride_id", "taxiRideId", "ride_id"],
  });
  if (!expectation.ok) {
    return {
      ok: false,
      error: `payment_expectation_${expectation.field}:${expectation.reason}`,
    };
  }

  if (paymentIntentId) {
    const walletBridge = await bridgeStripeWalletFromPaidTaxiRide(supabaseAdmin, {
      paymentIntentId,
      taxiRide: row,
      source,
    });
    if (walletBridge.ok === false) {
      return { ok: false, error: walletBridge.error };
    }
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
    console.log("[handleTaxiStripePayment] idempotent skip after rpc", {
      taxiRideId,
      source,
    });
    return { ok: true, already_paid: true };
  }

  // Crédit MMD: finalize the reserved store-credit now that the ride is paid.
  await captureEntityCredit(supabaseAdmin, "taxi_ride", taxiRideId);

  try {
    const { captureEntityMarketing } = await import(
      "@/lib/marketing/marketingCheckoutLifecycle"
    );
    await captureEntityMarketing(supabaseAdmin, "taxi", taxiRideId);
  } catch (e) {
    console.warn(
      "[marketing] taxi stripe capture fail-open",
      e instanceof Error ? e.message : e
    );
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
      actual_amount_cents: convertedStripeCents,
      stripe_amount: stripeAmountCents,
      expected_currency: rideCurrency,
    },
  });

  try {
    const { enqueueTaxiPaidFailOpen } = await import(
      "@/lib/finance/financeEvents"
    );
    await enqueueTaxiPaidFailOpen({
      supabaseAdmin,
      taxiRideId,
      amountCents: rideAmountCents,
      currency: row.currency,
      countryCode: row.country_code ?? null,
      paymentIntentId,
    });
  } catch (e) {
    console.warn(
      "[finance] taxi webhook taxi_paid enqueue fail-open",
      e instanceof Error ? e.message : e
    );
  }

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

async function markTaxiPaymentFailure(params: {
  supabaseAdmin: SupabaseClient;
  taxiRideId: string;
  sessionId?: string | null;
  paymentIntentId?: string | null;
  targetPaymentStatus: "unpaid" | "failed";
  source: string;
}): Promise<{
  ok: boolean;
  already_paid?: boolean;
  ignored?: string;
  error?: string;
  sync?: { updated: string[]; skipped: string[] };
}> {
  const {
    supabaseAdmin,
    taxiRideId,
    sessionId,
    paymentIntentId,
    targetPaymentStatus,
    source,
  } = params;

  const { data: ride, error: rideError } = await supabaseAdmin
    .from("taxi_rides")
    .select(
      "id,payment_status,refund_status,stripe_refund_id,stripe_session_id,stripe_payment_intent_id"
    )
    .eq("id", taxiRideId)
    .maybeSingle();

  if (rideError) return { ok: false, error: rideError.message };
  if (!ride) return { ok: false, error: "taxi_ride_not_found" };

  const row = ride as TaxiRidePaymentRow & {
    refund_status?: string | null;
    stripe_refund_id?: string | null;
  };

  const paymentStatus = String(row.payment_status ?? "").trim().toLowerCase();
  if (paymentStatus === "paid" || paymentStatus === "refunded") {
    return {
      ok: true,
      already_paid: true,
      sync: { updated: [], skipped: ["already_paid_or_refunded"] },
    };
  }

  if (
    String(row.refund_status ?? "").trim().toLowerCase() === "refunded" ||
    String(row.stripe_refund_id ?? "").trim()
  ) {
    return {
      ok: true,
      already_paid: true,
      sync: { updated: [], skipped: ["already_refunded"] },
    };
  }

  if (
    row.stripe_session_id &&
    sessionId &&
    row.stripe_session_id !== sessionId
  ) {
    return {
      ok: true,
      ignored: "session_id_mismatch",
      sync: { updated: [], skipped: ["session_mismatch"] },
    };
  }

  if (
    row.stripe_payment_intent_id &&
    paymentIntentId &&
    row.stripe_payment_intent_id !== paymentIntentId
  ) {
    return {
      ok: true,
      ignored: "payment_intent_mismatch",
      sync: { updated: [], skipped: ["payment_intent_mismatch"] },
    };
  }

  if (paymentStatus === targetPaymentStatus) {
    return {
      ok: true,
      sync: { updated: [], skipped: ["already_target_status"] },
    };
  }

  const nowIso = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    payment_status: targetPaymentStatus,
    updated_at: nowIso,
  };

  if (sessionId) updatePayload.stripe_session_id = sessionId;
  if (paymentIntentId) updatePayload.stripe_payment_intent_id = paymentIntentId;

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("taxi_rides")
    .update(updatePayload)
    .eq("id", taxiRideId)
    .neq("payment_status", "paid")
    .neq("payment_status", "refunded")
    .select("id")
    .maybeSingle();

  if (updateError) return { ok: false, error: updateError.message };

  if (!updated) {
    return {
      ok: true,
      sync: { updated: [], skipped: ["update_noop"] },
    };
  }

  // Crédit MMD: release the still-held reservation on failed/expired payment.
  await releaseEntityCredit(supabaseAdmin, "taxi_ride", taxiRideId);

  try {
    const { releaseEntityMarketing } = await import(
      "@/lib/marketing/marketingCheckoutLifecycle"
    );
    await releaseEntityMarketing(
      supabaseAdmin,
      "taxi",
      taxiRideId,
      `taxi_payment_${targetPaymentStatus}`
    );
  } catch (e) {
    console.warn(
      "[marketing] taxi release fail-open",
      e instanceof Error ? e.message : e
    );
  }

  console.log("[taxi-stripe-webhook] ride payment failure synced", {
    taxiRideId,
    targetPaymentStatus,
    sessionId,
    paymentIntentId,
    source,
  });

  return {
    ok: true,
    sync: { updated: [taxiRideId], skipped: [] },
  };
}

export async function handleTaxiStripeCheckoutExpired(params: {
  supabaseAdmin: SupabaseClient;
  taxiRideId: string;
  sessionId?: string | null;
  paymentIntentId?: string | null;
  source: string;
}) {
  return markTaxiPaymentFailure({
    ...params,
    targetPaymentStatus: "unpaid",
  });
}

export async function handleTaxiStripePaymentFailed(params: {
  supabaseAdmin: SupabaseClient;
  taxiRideId: string;
  paymentIntentId?: string | null;
  source: string;
}) {
  return markTaxiPaymentFailure({
    ...params,
    sessionId: null,
    targetPaymentStatus: "failed",
  });
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
