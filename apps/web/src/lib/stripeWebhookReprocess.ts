import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

type OrderPaymentRow = {
  payment_status: string | null;
};

type DeliveryPaymentRow = {
  payment_status: string | null;
};

function isPaidStatus(status: unknown): boolean {
  return String(status ?? "").trim().toLowerCase() === "paid";
}

function pickOrderIdFromMetadata(
  metadata: Record<string, unknown> | null
): string | null {
  if (!metadata) return null;
  const keys = ["order_id", "orderId", "order_uuid", "order"];
  for (const key of keys) {
    const value = String(metadata[key] ?? "").trim();
    if (value) return value;
  }
  return null;
}

function pickDeliveryRequestIdFromMetadata(
  metadata: Record<string, unknown> | null
): string | null {
  if (!metadata) return null;
  const keys = [
    "delivery_request_id",
    "deliveryRequestId",
    "delivery_request",
    "delivery_request_uuid",
  ];
  for (const key of keys) {
    const value = String(metadata[key] ?? "").trim();
    if (value) return value;
  }
  return null;
}

async function isOrderUnpaid(
  supabaseAdmin: SupabaseClient,
  orderId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("payment_status")
    .eq("id", orderId)
    .maybeSingle<OrderPaymentRow>();

  if (error || !data) return false;
  return !isPaidStatus(data.payment_status);
}

async function isDeliveryRequestUnpaid(
  supabaseAdmin: SupabaseClient,
  deliveryRequestId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("delivery_requests")
    .select("payment_status")
    .eq("id", deliveryRequestId)
    .maybeSingle<DeliveryPaymentRow>();

  if (error || !data) return false;
  return !isPaidStatus(data.payment_status);
}

async function orderMissingCommissions(
  supabaseAdmin: SupabaseClient,
  orderId: string
): Promise<boolean> {
  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .select("payment_status")
    .eq("id", orderId)
    .maybeSingle<OrderPaymentRow>();

  if (orderErr || !order || !isPaidStatus(order.payment_status)) {
    return false;
  }

  const { data: commission, error: commErr } = await supabaseAdmin
    .from("order_commissions")
    .select("order_id")
    .eq("order_id", orderId)
    .maybeSingle<{ order_id: string }>();

  if (commErr) return false;
  return !commission?.order_id;
}

async function resolveOrderIdForPaymentIntent(
  supabaseAdmin: SupabaseClient,
  paymentIntentId: string,
  metadata: Record<string, unknown> | null
): Promise<string | null> {
  const fromMd = pickOrderIdFromMetadata(metadata);
  if (fromMd) return fromMd;

  const { data } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .limit(1)
    .maybeSingle<{ id: string }>();

  return data?.id ?? null;
}

async function resolveDeliveryRequestIdForPaymentIntent(
  supabaseAdmin: SupabaseClient,
  paymentIntentId: string,
  metadata: Record<string, unknown> | null
): Promise<string | null> {
  const fromMd = pickDeliveryRequestIdFromMetadata(metadata);
  if (fromMd) return fromMd;

  const { data } = await supabaseAdmin
    .from("delivery_requests")
    .select("id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .limit(1)
    .maybeSingle<{ id: string }>();

  return data?.id ?? null;
}

/**
 * Returns true when a duplicate Stripe event should be reprocessed
 * (e.g. first attempt inserted audit row but crashed before mark paid).
 */
export async function stripeEventNeedsReprocessing(
  supabaseAdmin: SupabaseClient,
  event: Stripe.Event
): Promise<boolean> {
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const session = event.data.object as Stripe.Checkout.Session;
    const metadata = (session.metadata ?? null) as Record<string, unknown> | null;

    const orderId =
      pickOrderIdFromMetadata(metadata) ||
      (session.client_reference_id
        ? String(session.client_reference_id).trim()
        : null);

    const deliveryRequestId = pickDeliveryRequestIdFromMetadata(metadata);

    if (orderId) {
      if (await isOrderUnpaid(supabaseAdmin, orderId)) {
        return true;
      }
      if (await orderMissingCommissions(supabaseAdmin, orderId)) {
        return true;
      }
    }

    if (deliveryRequestId) {
      if (await isDeliveryRequestUnpaid(supabaseAdmin, deliveryRequestId)) {
        return true;
      }
    }

    return false;
  }

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent;
    const metadata = (pi.metadata ?? null) as Record<string, unknown> | null;
    const paymentIntentId = String(pi.id ?? "").trim();

    if (!paymentIntentId) return false;

    const orderId = await resolveOrderIdForPaymentIntent(
      supabaseAdmin,
      paymentIntentId,
      metadata
    );

    if (orderId) {
      if (await isOrderUnpaid(supabaseAdmin, orderId)) {
        return true;
      }
      if (await orderMissingCommissions(supabaseAdmin, orderId)) {
        return true;
      }
    }

    const deliveryRequestId = await resolveDeliveryRequestIdForPaymentIntent(
      supabaseAdmin,
      paymentIntentId,
      metadata
    );

    if (
      deliveryRequestId &&
      (await isDeliveryRequestUnpaid(supabaseAdmin, deliveryRequestId))
    ) {
      return true;
    }

    return false;
  }

  return false;
}
