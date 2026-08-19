/**
 * Official Admin cancel + optional Stripe refund for Food/Marketplace orders.
 * Used by /api/admin/orders/cancel-refund and stale-job ops — never raw SQL status flips.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

export type AdminCancelOrderResult = {
  ok: true;
  order: Record<string, unknown> | null;
  alreadyRefunded: boolean;
  refundedNow: boolean;
  stripeRefund: { id: string; status: string | null } | null;
  alreadyCanceled: boolean;
};

export async function adminCancelOrderRefundCore(params: {
  supabaseAdmin: SupabaseClient;
  stripe: Stripe;
  orderId: string;
  adminUserId: string;
  adminReason: string;
}): Promise<AdminCancelOrderResult> {
  const { supabaseAdmin, stripe, orderId, adminUserId, adminReason } = params;
  const nowIso = new Date().toISOString();

  const { data: order, error: readError } = await supabaseAdmin
    .from("orders")
    .select(
      `id, status, payment_status, refund_status,
       stripe_payment_intent_id, stripe_refund_id, stripe_refunded_at,
       driver_id, cancel_reason, cancelled_by, cancelled_at,
       picked_up_at, delivered_at, delivered_confirmed_at`,
    )
    .eq("id", orderId)
    .maybeSingle();

  if (readError) throw new Error(readError.message);
  if (!order) throw new Error("Order not found");

  const status = String(order.status ?? "")
    .trim()
    .toLowerCase();
  if (status === "canceled" || status === "cancelled") {
    return {
      ok: true,
      order: order as Record<string, unknown>,
      alreadyRefunded: Boolean(order.stripe_refund_id || order.stripe_refunded_at),
      refundedNow: false,
      stripeRefund: null,
      alreadyCanceled: true,
    };
  }

  // Safety: refuse cancel when delivery evidence exists (use force-complete instead).
  const hasExecutionEvidence = [
    order.picked_up_at,
    order.delivered_at,
    order.delivered_confirmed_at,
  ].some((v) => Boolean(String(v ?? "").trim()));
  if (hasExecutionEvidence) {
    throw new Error(
      "Order has pickup/delivery evidence — use Force Complete, not Cancel",
    );
  }

  let stripeRefund: { id: string; status: string | null } | null = null;
  const alreadyRefunded =
    !!order.stripe_refund_id || !!order.stripe_refunded_at;
  const canRefund =
    order.payment_status === "paid" &&
    !!order.stripe_payment_intent_id &&
    !alreadyRefunded;

  if (canRefund) {
    const refund = await stripe.refunds.create(
      {
        payment_intent: String(order.stripe_payment_intent_id),
        reason: "requested_by_customer",
        metadata: {
          order_id: orderId,
          admin_id: adminUserId,
          reason: adminReason,
        },
      },
      { idempotencyKey: `admin_cancel_refund_${orderId}` },
    );
    stripeRefund = { id: refund.id, status: refund.status };
  }

  const updatePayload: Record<string, unknown> = {
    status: "canceled",
    driver_id: null,
    cancel_reason: adminReason,
    cancelled_by: "admin",
    cancelled_at: nowIso,
    refund_status: canRefund
      ? "refunded"
      : alreadyRefunded
        ? "refunded"
        : order.payment_status === "paid"
          ? "missing_payment_intent"
          : "not_paid",
  };

  if (stripeRefund?.id) {
    updatePayload.stripe_refund_id = stripeRefund.id;
    updatePayload.stripe_refunded_at = nowIso;
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("orders")
    .update(updatePayload)
    .eq("id", orderId)
    .select(
      "id,status,refund_status,stripe_refund_id,stripe_refunded_at,driver_id,cancelled_at",
    )
    .maybeSingle();

  if (updateError) throw new Error(updateError.message);

  return {
    ok: true,
    order: (updated ?? updatePayload) as Record<string, unknown>,
    alreadyRefunded,
    refundedNow: !!stripeRefund?.id,
    stripeRefund,
    alreadyCanceled: false,
  };
}
