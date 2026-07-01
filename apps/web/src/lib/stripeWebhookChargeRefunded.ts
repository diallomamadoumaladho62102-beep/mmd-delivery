import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

type RefundSyncResult = {
  updated: string[];
  skipped: string[];
};

function paymentIntentIdFromCharge(charge: Stripe.Charge): string | null {
  const pi = charge.payment_intent;
  if (typeof pi === "string" && pi.trim()) return pi.trim();
  if (pi && typeof pi === "object" && "id" in pi && typeof pi.id === "string") {
    return pi.id.trim();
  }
  return null;
}

function primaryRefundId(charge: Stripe.Charge): string | null {
  const refund = charge.refunds?.data?.[0];
  return typeof refund?.id === "string" && refund.id.trim() ? refund.id.trim() : null;
}

async function markRefundedByPaymentIntent(
  supabaseAdmin: SupabaseClient,
  table: "orders" | "delivery_requests" | "taxi_rides",
  paymentIntentId: string,
  refundId: string | null,
  refundedAt: string,
): Promise<string[]> {
  const { data: rows, error } = await supabaseAdmin
    .from(table)
    .select("id, stripe_refund_id, refund_status, payment_status")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .limit(20);

  if (error) {
    throw new Error(`${table} refund lookup failed: ${error.message}`);
  }

  const updated: string[] = [];

  for (const row of rows ?? []) {
    const id = String((row as { id?: string }).id ?? "");
    if (!id) continue;

    const existingRefundId = String(
      (row as { stripe_refund_id?: string | null }).stripe_refund_id ?? "",
    ).trim();
    if (existingRefundId) continue;

    const { error: updateError } = await supabaseAdmin
      .from(table)
      .update({
        refund_status: "refunded",
        payment_status: "refunded",
        stripe_refund_id: refundId,
        stripe_refunded_at: refundedAt,
      })
      .eq("id", id);

    if (updateError) {
      throw new Error(`${table} refund update failed: ${updateError.message}`);
    }

    updated.push(id);
  }

  return updated;
}

export async function syncStripeChargeRefunded(params: {
  supabaseAdmin: SupabaseClient;
  charge: Stripe.Charge;
}): Promise<RefundSyncResult> {
  const paymentIntentId = paymentIntentIdFromCharge(params.charge);
  if (!paymentIntentId) {
    return { updated: [], skipped: ["missing_payment_intent"] };
  }

  const refundId = primaryRefundId(params.charge);
  const refundedAt = new Date(
    (params.charge.refunds?.data?.[0]?.created ?? params.charge.created) * 1000,
  ).toISOString();

  const updated = [
    ...(await markRefundedByPaymentIntent(
      params.supabaseAdmin,
      "orders",
      paymentIntentId,
      refundId,
      refundedAt,
    )),
    ...(await markRefundedByPaymentIntent(
      params.supabaseAdmin,
      "delivery_requests",
      paymentIntentId,
      refundId,
      refundedAt,
    )),
    ...(await markRefundedByPaymentIntent(
      params.supabaseAdmin,
      "taxi_rides",
      paymentIntentId,
      refundId,
      refundedAt,
    )),
  ];

  if (updated.length === 0) {
    return { updated: [], skipped: ["no_matching_rows"] };
  }

  return { updated, skipped: [] };
}

export async function syncStripeRefundObject(params: {
  supabaseAdmin: SupabaseClient;
  refund: Stripe.Refund;
}): Promise<RefundSyncResult> {
  const paymentIntentId =
    typeof params.refund.payment_intent === "string"
      ? params.refund.payment_intent.trim()
      : null;

  if (!paymentIntentId) {
    return { updated: [], skipped: ["missing_payment_intent"] };
  }

  const refundedAt = new Date(params.refund.created * 1000).toISOString();
  const refundId = String(params.refund.id ?? "").trim() || null;

  const updated = [
    ...(await markRefundedByPaymentIntent(
      params.supabaseAdmin,
      "orders",
      paymentIntentId,
      refundId,
      refundedAt,
    )),
    ...(await markRefundedByPaymentIntent(
      params.supabaseAdmin,
      "delivery_requests",
      paymentIntentId,
      refundId,
      refundedAt,
    )),
    ...(await markRefundedByPaymentIntent(
      params.supabaseAdmin,
      "taxi_rides",
      paymentIntentId,
      refundId,
      refundedAt,
    )),
  ];

  if (updated.length === 0) {
    return { updated: [], skipped: ["no_matching_rows"] };
  }

  return { updated, skipped: [] };
}
