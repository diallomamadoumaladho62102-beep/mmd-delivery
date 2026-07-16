import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyMarketplaceClientOrderStatus } from "@/lib/marketplacePushNotifications";

const PAID_STATUSES = new Set(["paid", "confirmed"]);
const BEFORE_OUT_FOR_DELIVERY = new Set([
  "paid",
  "confirmed",
  "accepted",
  "preparing",
  "ready",
]);

export type MarketplaceSellerStatusTransition =
  | "accepted"
  | "refused"
  | "preparing"
  | "ready"
  | "out_for_delivery";

const ALLOWED_FROM: Record<MarketplaceSellerStatusTransition, string[]> = {
  accepted: ["paid", "confirmed"],
  refused: ["paid", "confirmed"],
  preparing: ["accepted"],
  ready: ["preparing"],
  out_for_delivery: ["ready"],
};

export function isMarketplaceOrderPaidLike(order: {
  status?: string | null;
  payment_status?: string | null;
}): boolean {
  return order.payment_status === "paid" || PAID_STATUSES.has(String(order.status ?? ""));
}

export function canCancelMarketplacePaidOrder(status: string): boolean {
  return BEFORE_OUT_FOR_DELIVERY.has(status);
}

export async function loadSellerOwnedByUser(
  supabaseAdmin: SupabaseClient,
  userId: string
): Promise<{ id: string; user_id: string } | null> {
  const { data, error } = await supabaseAdmin
    .from("sellers")
    .select("id,user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function transitionMarketplaceSellerOrderStatus(
  supabaseAdmin: SupabaseClient,
  params: {
    sellerUserId: string;
    orderId: string;
    nextStatus: MarketplaceSellerStatusTransition;
    cancelReason?: string | null;
  }
): Promise<
  | {
      ok: true;
      order: Record<string, unknown>;
      stripe_refund_deferred?: boolean;
      refund_status?: string | null;
    }
  | { ok: false; error: string }
> {
  const seller = await loadSellerOwnedByUser(supabaseAdmin, params.sellerUserId);
  if (!seller) return { ok: false, error: "seller_not_found" };

  const { data: order, error: loadError } = await supabaseAdmin
    .from("seller_orders")
    .select(
      "id,seller_id,client_user_id,status,payment_status,refund_status,cancelled_by,cancelled_at,cancel_reason"
    )
    .eq("id", params.orderId)
    .eq("seller_id", seller.id)
    .maybeSingle();

  if (loadError) return { ok: false, error: loadError.message };
  if (!order) return { ok: false, error: "order_not_found" };

  if (!isMarketplaceOrderPaidLike(order) && !PAID_STATUSES.has(String(order.status))) {
    return { ok: false, error: "order_not_paid" };
  }

  const allowedFrom = ALLOWED_FROM[params.nextStatus];
  if (!allowedFrom.includes(String(order.status))) {
    return { ok: false, error: "invalid_status_transition" };
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: params.nextStatus,
    updated_at: now,
  };

  let stripeRefundDeferred = false;
  if (params.nextStatus === "refused") {
    patch.refund_status = "full_refund_required";
    patch.cancelled_by = "seller";
    patch.cancelled_at = now;
    patch.cancel_reason = params.cancelReason?.trim() || "refused_by_seller";
    stripeRefundDeferred = true;
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("seller_orders")
    .update(patch)
    .eq("id", params.orderId)
    .eq("seller_id", seller.id)
    .eq("status", order.status)
    .select(
      "id,seller_id,client_user_id,status,payment_status,refund_status,cancelled_by,cancelled_at,cancel_reason,updated_at"
    )
    .maybeSingle();

  if (updateError) return { ok: false, error: updateError.message };
  if (!updated) return { ok: false, error: "order_update_failed" };

  void notifyMarketplaceClientOrderStatus({
    supabaseAdmin,
    clientUserId: String(updated.client_user_id ?? order.client_user_id ?? ""),
    orderId: params.orderId,
    status: params.nextStatus,
  }).catch((notifyError) => {
    console.warn(
      "[marketplace-lifecycle] client notify failed:",
      notifyError instanceof Error ? notifyError.message : notifyError
    );
  });

  return {
    ok: true,
    order: updated as Record<string, unknown>,
    ...(stripeRefundDeferred
      ? {
          stripe_refund_deferred: true,
          refund_status: "full_refund_required",
        }
      : {}),
  };
}

export async function cancelMarketplaceOrder(
  supabaseAdmin: SupabaseClient,
  params: {
    actorUserId: string;
    orderId: string;
    actorRole: "client" | "seller";
    cancelReason?: string | null;
  }
): Promise<
  | {
      ok: true;
      order: Record<string, unknown>;
      stripe_refund_deferred?: boolean;
      refund_status?: string | null;
    }
  | { ok: false; error: string }
> {
  const { data: order, error: loadError } = await supabaseAdmin
    .from("seller_orders")
    .select(
      "id,seller_id,client_user_id,status,payment_status,refund_status,cancelled_by,cancelled_at,cancel_reason"
    )
    .eq("id", params.orderId)
    .maybeSingle();

  if (loadError) return { ok: false, error: loadError.message };
  if (!order) return { ok: false, error: "order_not_found" };

  if (params.actorRole === "client") {
    if (String(order.client_user_id) !== params.actorUserId) {
      return { ok: false, error: "forbidden" };
    }
  } else {
    const seller = await loadSellerOwnedByUser(supabaseAdmin, params.actorUserId);
    if (!seller || seller.id !== order.seller_id) {
      return { ok: false, error: "forbidden" };
    }
  }

  const status = String(order.status);
  const unpaidStatuses = new Set([
    "draft",
    "pending_checkout",
    "pending_payment",
    "pending",
    "payment_failed",
  ]);
  const isPaid = isMarketplaceOrderPaidLike(order);
  const now = new Date().toISOString();

  // Client (or seller) may cancel unpaid/draft freely — no refund needed.
  if (!isPaid && unpaidStatuses.has(status)) {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("seller_orders")
      .update({
        status: "canceled",
        cancelled_by: params.actorRole,
        cancelled_at: now,
        cancel_reason: params.cancelReason?.trim() || "cancelled_by_user",
        updated_at: now,
      })
      .eq("id", params.orderId)
      .select(
        "id,seller_id,client_user_id,status,payment_status,refund_status,cancelled_by,cancelled_at,cancel_reason,updated_at"
      )
      .maybeSingle();

    if (updateError) return { ok: false, error: updateError.message };
    if (!updated) return { ok: false, error: "order_update_failed" };
    void notifyMarketplaceClientOrderStatus({
      supabaseAdmin,
      clientUserId: String(updated.client_user_id ?? order.client_user_id ?? ""),
      orderId: params.orderId,
      status: "canceled",
    }).catch(() => undefined);
    return { ok: true, order: updated as Record<string, unknown> };
  }

  // Paid cancel before out_for_delivery — mark refund required, do NOT call Stripe.
  if (!isPaid) {
    return { ok: false, error: "order_not_cancellable" };
  }

  if (!canCancelMarketplacePaidOrder(status)) {
    return { ok: false, error: "order_not_cancellable" };
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("seller_orders")
    .update({
      status: "canceled",
      refund_status: "full_refund_required",
      cancelled_by: params.actorRole,
      cancelled_at: now,
      cancel_reason: params.cancelReason?.trim() || `cancelled_by_${params.actorRole}`,
      updated_at: now,
    })
    .eq("id", params.orderId)
    .select(
      "id,seller_id,client_user_id,status,payment_status,refund_status,cancelled_by,cancelled_at,cancel_reason,updated_at"
    )
    .maybeSingle();

  if (updateError) return { ok: false, error: updateError.message };
  if (!updated) return { ok: false, error: "order_update_failed" };

  void notifyMarketplaceClientOrderStatus({
    supabaseAdmin,
    clientUserId: String(updated.client_user_id ?? order.client_user_id ?? ""),
    orderId: params.orderId,
    status: "canceled",
  }).catch(() => undefined);

  return {
    ok: true,
    order: updated as Record<string, unknown>,
    stripe_refund_deferred: true,
    refund_status: "full_refund_required",
  };
}
