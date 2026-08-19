/**
 * Official Admin cancel + optional Stripe refund for delivery_requests.
 * Mirrors Food order cancel — audited callers only; no raw SQL status flips.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

export type AdminCancelDeliveryResult = {
  ok: true;
  delivery_request: Record<string, unknown> | null;
  alreadyRefunded: boolean;
  refundedNow: boolean;
  stripeRefund: { id: string; status: string | null } | null;
  alreadyCanceled: boolean;
};

export async function adminCancelDeliveryRequestRefundCore(params: {
  supabaseAdmin: SupabaseClient;
  stripe: Stripe;
  deliveryRequestId: string;
  adminUserId: string;
  adminReason: string;
}): Promise<AdminCancelDeliveryResult> {
  const {
    supabaseAdmin,
    stripe,
    deliveryRequestId,
    adminUserId,
    adminReason,
  } = params;
  const nowIso = new Date().toISOString();

  const { data: row, error: readError } = await supabaseAdmin
    .from("delivery_requests")
    .select(
      `id, status, payment_status, refund_status,
       stripe_payment_intent_id, stripe_refund_id, stripe_refunded_at,
       driver_id, cancel_reason, cancelled_by, cancelled_at,
       picked_up_at, delivered_at, dropoff_code_verified_at`,
    )
    .eq("id", deliveryRequestId)
    .maybeSingle();

  if (readError) throw new Error(readError.message);
  if (!row) throw new Error("Delivery request not found");

  const status = String(row.status ?? "")
    .trim()
    .toLowerCase();
  if (status === "canceled" || status === "cancelled") {
    return {
      ok: true,
      delivery_request: row as Record<string, unknown>,
      alreadyRefunded: Boolean(row.stripe_refund_id || row.stripe_refunded_at),
      refundedNow: false,
      stripeRefund: null,
      alreadyCanceled: true,
    };
  }

  const hasExecutionEvidence = [
    row.picked_up_at,
    row.delivered_at,
    row.dropoff_code_verified_at,
  ].some((v) => Boolean(String(v ?? "").trim()));
  if (hasExecutionEvidence) {
    throw new Error(
      "Delivery has pickup/dropoff evidence — use Force Complete, not Cancel",
    );
  }

  let stripeRefund: { id: string; status: string | null } | null = null;
  const alreadyRefunded = !!row.stripe_refund_id || !!row.stripe_refunded_at;
  const canRefund =
    String(row.payment_status ?? "").toLowerCase() === "paid" &&
    !!row.stripe_payment_intent_id &&
    !alreadyRefunded;

  if (canRefund) {
    const refund = await stripe.refunds.create(
      {
        payment_intent: String(row.stripe_payment_intent_id),
        reason: "requested_by_customer",
        metadata: {
          delivery_request_id: deliveryRequestId,
          admin_id: adminUserId,
          reason: adminReason,
        },
      },
      { idempotencyKey: `admin_delivery_cancel_refund_${deliveryRequestId}` },
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
        : String(row.payment_status ?? "").toLowerCase() === "paid"
          ? "missing_payment_intent"
          : "not_paid",
  };

  if (stripeRefund?.id) {
    updatePayload.stripe_refund_id = stripeRefund.id;
    updatePayload.stripe_refunded_at = nowIso;
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("delivery_requests")
    .update(updatePayload)
    .eq("id", deliveryRequestId)
    .select(
      "id,status,refund_status,stripe_refund_id,stripe_refunded_at,driver_id,cancelled_at",
    )
    .maybeSingle();

  if (updateError) throw new Error(updateError.message);

  return {
    ok: true,
    delivery_request: (updated ?? updatePayload) as Record<string, unknown>,
    alreadyRefunded,
    refundedNow: !!stripeRefund?.id,
    stripeRefund,
    alreadyCanceled: false,
  };
}
