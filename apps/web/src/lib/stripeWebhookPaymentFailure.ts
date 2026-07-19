import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import {
  handleMarketplaceCheckoutSessionExpired,
  handleMarketplaceStripePaymentFailed,
  isMarketplaceStripeModule,
  pickSellerOrderIdFromMetadata,
} from "@/lib/marketplaceStripeWebhook";
import {
  handleTaxiStripeCheckoutExpired,
  handleTaxiStripePaymentFailed,
  isTaxiStripeModule,
  pickTaxiRideIdFromMetadata,
} from "@/lib/taxiStripeWebhook";
import { releaseEntityCredit } from "@/lib/loyalty/loyaltyCredit";

export const STRIPE_WEBHOOK_FAILURE_EVENT_TYPES = [
  "checkout.session.expired",
  "payment_intent.payment_failed",
] as const;

type PaymentRowTable = "orders" | "delivery_requests" | "taxi_rides";

export function isPaidLikePaymentStatus(status: unknown): boolean {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized === "paid" || normalized === "refunded";
}

export function isRefundedLikeRow(row: {
  payment_status?: unknown;
  refund_status?: unknown;
  stripe_refund_id?: unknown;
}): boolean {
  if (isPaidLikePaymentStatus(row.payment_status)) return true;
  if (String(row.refund_status ?? "").trim().toLowerCase() === "refunded") {
    return true;
  }
  return Boolean(String(row.stripe_refund_id ?? "").trim());
}

export function isStripeReferenceCompatible(
  existing: unknown,
  incoming: unknown,
): boolean {
  const existingValue = String(existing ?? "").trim();
  const incomingValue = String(incoming ?? "").trim();
  if (!incomingValue) return true;
  if (!existingValue) return true;
  return existingValue === incomingValue;
}

export function shouldApplyPaymentFailureUpdate(params: {
  payment_status?: unknown;
  refund_status?: unknown;
  stripe_refund_id?: unknown;
  stripe_session_id?: unknown;
  stripe_payment_intent_id?: unknown;
  incoming_session_id?: unknown;
  incoming_payment_intent_id?: unknown;
}): { apply: boolean; reason: string } {
  if (
    isRefundedLikeRow({
      payment_status: params.payment_status,
      refund_status: params.refund_status,
      stripe_refund_id: params.stripe_refund_id,
    })
  ) {
    return { apply: false, reason: "already_paid_or_refunded" };
  }

  if (
    !isStripeReferenceCompatible(
      params.stripe_session_id,
      params.incoming_session_id,
    )
  ) {
    return { apply: false, reason: "session_mismatch" };
  }

  if (
    !isStripeReferenceCompatible(
      params.stripe_payment_intent_id,
      params.incoming_payment_intent_id,
    )
  ) {
    return { apply: false, reason: "payment_intent_mismatch" };
  }

  return { apply: true, reason: "eligible" };
}

function paymentIntentIdFromUnknown(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && "id" in value) {
    const maybeId = (value as { id?: unknown }).id;
    if (typeof maybeId === "string" && maybeId.trim()) return maybeId.trim();
  }
  return null;
}

function pickOrderIdFromMetadata(
  md: Record<string, unknown> | null | undefined,
): string | null {
  const raw =
    md?.orderId ??
    md?.order_id ??
    md?.orderID ??
    md?.order ??
    md?.order_uuid ??
    null;
  if (!raw) return null;
  const normalized = String(raw).trim();
  return normalized.length > 0 ? normalized : null;
}

function pickDeliveryRequestIdFromMetadata(
  md: Record<string, unknown> | null | undefined,
): string | null {
  const raw =
    md?.deliveryRequestId ??
    md?.delivery_request_id ??
    md?.delivery_requestId ??
    md?.deliveryRequestID ??
    md?.delivery_request ??
    md?.delivery ??
    md?.requestId ??
    md?.request_id ??
    md?.delivery_request_uuid ??
    null;
  if (!raw) return null;
  const normalized = String(raw).trim();
  return normalized.length > 0 ? normalized : null;
}

type FailureSyncResult = {
  updated: string[];
  skipped: string[];
};

async function markCorePaymentFailure(
  supabaseAdmin: SupabaseClient,
  table: PaymentRowTable,
  rowId: string,
  params: {
    targetPaymentStatus: "unpaid" | "failed";
    sessionId?: string | null;
    paymentIntentId?: string | null;
  },
): Promise<FailureSyncResult> {
  const selectColumns =
    table === "orders"
      ? "id, payment_status, refund_status, stripe_refund_id, stripe_session_id, stripe_payment_intent_id"
      : "id, payment_status, refund_status, stripe_refund_id, stripe_session_id, stripe_payment_intent_id";

  const { data: row, error: readError } = await supabaseAdmin
    .from(table)
    .select(selectColumns)
    .eq("id", rowId)
    .maybeSingle();

  if (readError) {
    throw new Error(`${table} failure lookup failed: ${readError.message}`);
  }

  if (!row) {
    return { updated: [], skipped: ["not_found"] };
  }

  const decision = shouldApplyPaymentFailureUpdate({
    payment_status: (row as { payment_status?: unknown }).payment_status,
    refund_status: (row as { refund_status?: unknown }).refund_status,
    stripe_refund_id: (row as { stripe_refund_id?: unknown }).stripe_refund_id,
    stripe_session_id: (row as { stripe_session_id?: unknown }).stripe_session_id,
    stripe_payment_intent_id: (row as {
      stripe_payment_intent_id?: unknown;
    }).stripe_payment_intent_id,
    incoming_session_id: params.sessionId,
    incoming_payment_intent_id: params.paymentIntentId,
  });

  if (!decision.apply) {
    return { updated: [], skipped: [decision.reason] };
  }

  const currentStatus = String(
    (row as { payment_status?: unknown }).payment_status ?? "",
  )
    .trim()
    .toLowerCase();

  if (currentStatus === params.targetPaymentStatus) {
    return { updated: [], skipped: ["already_target_status"] };
  }

  const nowIso = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    payment_status: params.targetPaymentStatus,
    updated_at: nowIso,
  };

  if (params.sessionId) {
    updatePayload.stripe_session_id = params.sessionId;
  }
  if (params.paymentIntentId) {
    updatePayload.stripe_payment_intent_id = params.paymentIntentId;
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from(table)
    .update(updatePayload)
    .eq("id", rowId)
    .neq("payment_status", "paid")
    .neq("payment_status", "refunded")
    .select("id")
    .maybeSingle();

  if (updateError) {
    throw new Error(`${table} failure update failed: ${updateError.message}`);
  }

  if (!updated) {
    return { updated: [], skipped: ["update_noop"] };
  }

  // Crédit MMD: release the still-held reservation on failed/expired payment.
  await releaseEntityCredit(
    supabaseAdmin,
    table === "orders" ? "food_order" : "delivery_request",
    rowId,
  );

  try {
    const { releaseEntityMarketing } = await import(
      "@/lib/marketing/marketingCheckoutLifecycle"
    );
    await releaseEntityMarketing(
      supabaseAdmin,
      table === "orders" ? "food" : "delivery",
      rowId,
      "payment_failed_or_expired"
    );
  } catch (e) {
    console.warn(
      "[marketing] release on payment failure fail-open",
      e instanceof Error ? e.message : e
    );
  }

  return { updated: [rowId], skipped: [] };
}

export async function handleCheckoutSessionExpiredEvent(params: {
  supabaseAdmin: SupabaseClient;
  session: Stripe.Checkout.Session;
  eventType: string;
}): Promise<Record<string, unknown>> {
  const { supabaseAdmin, session, eventType } = params;
  const metadata = (session.metadata ?? null) as Record<string, unknown> | null;
  const sessionId = String(session.id ?? "").trim() || null;
  const paymentIntentId = paymentIntentIdFromUnknown(session.payment_intent);

  if (isTaxiStripeModule(metadata)) {
    const taxiRideId = pickTaxiRideIdFromMetadata(metadata);
    if (!taxiRideId) {
      return {
        received: true,
        ignored: "missing taxi_ride_id for module=taxi",
        type: eventType,
      };
    }

    const taxiResult = await handleTaxiStripeCheckoutExpired({
      supabaseAdmin,
      taxiRideId,
      sessionId,
      paymentIntentId,
      source: `webhook:${eventType}`,
    });

    return {
      received: true,
      ok: taxiResult.ok,
      type: eventType,
      taxi_ride_id: taxiRideId,
      ignored: taxiResult.ignored,
      already_paid: taxiResult.already_paid,
      payment_failure_sync: taxiResult.sync,
      error: taxiResult.error,
    };
  }

  if (isMarketplaceStripeModule(metadata)) {
    const sellerOrderId = pickSellerOrderIdFromMetadata(metadata);
    if (!sellerOrderId) {
      return {
        received: true,
        ignored: "missing seller_order_id for module=marketplace",
        type: eventType,
      };
    }

    const marketplaceResult = await handleMarketplaceCheckoutSessionExpired({
      supabaseAdmin,
      sellerOrderId,
      sessionId,
      paymentIntentId,
      source: `webhook:${eventType}`,
    });

    return {
      received: true,
      ok: marketplaceResult.ok,
      type: eventType,
      seller_order_id: sellerOrderId,
      ignored: marketplaceResult.ignored,
      payment_failure_sync: marketplaceResult.sync,
      error: marketplaceResult.error,
    };
  }

  const orderId =
    pickOrderIdFromMetadata(metadata) ||
    (session.client_reference_id
      ? String(session.client_reference_id).trim()
      : null);
  const deliveryRequestId = pickDeliveryRequestIdFromMetadata(metadata);

  if (!orderId && !deliveryRequestId) {
    return {
      received: true,
      ignored: "missing orderId/order_id and deliveryRequestId/delivery_request_id",
      type: eventType,
    };
  }

  const sync: FailureSyncResult = { updated: [], skipped: [] };

  if (orderId) {
    const orderResult = await markCorePaymentFailure(
      supabaseAdmin,
      "orders",
      orderId,
      {
        targetPaymentStatus: "unpaid",
        sessionId,
        paymentIntentId,
      },
    );
    sync.updated.push(...orderResult.updated.map((id) => `order:${id}`));
    sync.skipped.push(...orderResult.skipped.map((reason) => `order:${reason}`));
  }

  if (deliveryRequestId) {
    const deliveryResult = await markCorePaymentFailure(
      supabaseAdmin,
      "delivery_requests",
      deliveryRequestId,
      {
        targetPaymentStatus: "unpaid",
        sessionId,
        paymentIntentId,
      },
    );
    sync.updated.push(
      ...deliveryResult.updated.map((id) => `delivery_request:${id}`),
    );
    sync.skipped.push(
      ...deliveryResult.skipped.map((reason) => `delivery_request:${reason}`),
    );
  }

  return {
    received: true,
    ok: true,
    type: eventType,
    order_id: orderId,
    delivery_request_id: deliveryRequestId,
    payment_failure_sync: sync,
  };
}

export async function handlePaymentIntentFailedEvent(params: {
  supabaseAdmin: SupabaseClient;
  paymentIntent: Stripe.PaymentIntent;
  eventType: string;
}): Promise<Record<string, unknown>> {
  const { supabaseAdmin, paymentIntent, eventType } = params;
  const metadata = (paymentIntent.metadata ?? null) as Record<
    string,
    unknown
  > | null;
  const paymentIntentId = String(paymentIntent.id ?? "").trim() || null;

  if (isTaxiStripeModule(metadata)) {
    const taxiRideId = pickTaxiRideIdFromMetadata(metadata);
    if (!taxiRideId) {
      return {
        received: true,
        ignored: "missing taxi_ride_id for module=taxi",
        type: eventType,
      };
    }

    const taxiResult = await handleTaxiStripePaymentFailed({
      supabaseAdmin,
      taxiRideId,
      paymentIntentId,
      source: `webhook:${eventType}`,
    });

    return {
      received: true,
      ok: taxiResult.ok,
      type: eventType,
      taxi_ride_id: taxiRideId,
      ignored: taxiResult.ignored,
      already_paid: taxiResult.already_paid,
      payment_failure_sync: taxiResult.sync,
      error: taxiResult.error,
    };
  }

  if (isMarketplaceStripeModule(metadata)) {
    const sellerOrderId = pickSellerOrderIdFromMetadata(metadata);
    if (!sellerOrderId) {
      return {
        received: true,
        ignored: "missing seller_order_id for module=marketplace",
        type: eventType,
      };
    }

    const marketplaceResult = await handleMarketplaceStripePaymentFailed({
      supabaseAdmin,
      sellerOrderId,
      paymentIntentId,
      source: `webhook:${eventType}`,
    });

    return {
      received: true,
      ok: marketplaceResult.ok,
      type: eventType,
      seller_order_id: sellerOrderId,
      ignored: marketplaceResult.ignored,
      payment_failure_sync: marketplaceResult.sync,
      error: marketplaceResult.error,
    };
  }

  const orderId = pickOrderIdFromMetadata(metadata);
  const deliveryRequestId = pickDeliveryRequestIdFromMetadata(metadata);

  if (!orderId && !deliveryRequestId) {
    return {
      received: true,
      ignored: "missing orderId/order_id and deliveryRequestId/delivery_request_id",
      type: eventType,
    };
  }

  const sync: FailureSyncResult = { updated: [], skipped: [] };

  if (orderId) {
    const orderResult = await markCorePaymentFailure(
      supabaseAdmin,
      "orders",
      orderId,
      {
        targetPaymentStatus: "failed",
        paymentIntentId,
      },
    );
    sync.updated.push(...orderResult.updated.map((id) => `order:${id}`));
    sync.skipped.push(...orderResult.skipped.map((reason) => `order:${reason}`));
  }

  if (deliveryRequestId) {
    const deliveryResult = await markCorePaymentFailure(
      supabaseAdmin,
      "delivery_requests",
      deliveryRequestId,
      {
        targetPaymentStatus: "failed",
        paymentIntentId,
      },
    );
    sync.updated.push(
      ...deliveryResult.updated.map((id) => `delivery_request:${id}`),
    );
    sync.skipped.push(
      ...deliveryResult.skipped.map((reason) => `delivery_request:${reason}`),
    );
  }

  return {
    received: true,
    ok: true,
    type: eventType,
    order_id: orderId,
    delivery_request_id: deliveryRequestId,
    payment_failure_sync: sync,
  };
}
