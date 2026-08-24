import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

type OrderPaymentRow = {
  payment_status: string | null;
};

type DeliveryPaymentRow = {
  payment_status: string | null;
};

type TaxiPaymentRow = {
  payment_status: string | null;
};

function isPaidStatus(status: unknown): boolean {
  return String(status ?? "").trim().toLowerCase() === "paid";
}

function isTaxiStripeModule(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  return String(metadata?.module ?? "").trim().toLowerCase() === "taxi";
}

function isDriverTipPaymentIntent(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  const kind = String(metadata?.kind ?? "").trim().toLowerCase();
  return kind === "driver_tip" || kind === "taxi_driver_tip";
}

function pickTaxiRideIdFromTipMetadata(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  if (!metadata) return null;
  for (const key of ["taxi_ride_id", "taxiRideId", "ride_id"]) {
    const value = String(metadata[key] ?? "").trim();
    if (value) return value;
  }
  return null;
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

function pickTaxiRideIdFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  if (!isTaxiStripeModule(metadata)) return null;

  const raw =
    metadata?.taxiRideId ?? metadata?.taxi_ride_id ?? metadata?.ride_id ?? null;
  if (!raw) return null;

  const normalized = String(raw).trim();
  return normalized.length > 0 ? normalized : null;
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

async function isTaxiRideUnpaid(
  supabaseAdmin: SupabaseClient,
  taxiRideId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("taxi_rides")
    .select("payment_status")
    .eq("id", taxiRideId)
    .maybeSingle<TaxiPaymentRow>();

  if (error || !data) return false;
  return !isPaidStatus(data.payment_status);
}

/** Driver tip transfer not yet completed for this order (see executeDriverTipTransfer). */
async function isOrderTipUntransferred(
  supabaseAdmin: SupabaseClient,
  orderId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("tip_paid_out")
    .eq("id", orderId)
    .maybeSingle<{ tip_paid_out: boolean | null }>();

  if (error || !data) return false;
  return data.tip_paid_out !== true;
}

/** Taxi tip SCT not yet completed (see executeTaxiDriverTipTransfer). */
async function isTaxiRideTipUntransferred(
  supabaseAdmin: SupabaseClient,
  taxiRideId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("taxi_rides")
    .select("tip_paid_out")
    .eq("id", taxiRideId)
    .maybeSingle<{ tip_paid_out: boolean | null }>();

  if (error || !data) return false;
  return data.tip_paid_out !== true;
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

async function resolveTaxiRideIdForPaymentIntent(
  supabaseAdmin: SupabaseClient,
  paymentIntentId: string,
  metadata: Record<string, unknown> | null
): Promise<string | null> {
  const fromMd = pickTaxiRideIdFromMetadata(metadata);
  if (fromMd) return fromMd;

  const { data } = await supabaseAdmin
    .from("taxi_rides")
    .select("id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .limit(1)
    .maybeSingle<{ id: string }>();

  return data?.id ?? null;
}

async function resolveTaxiRideIdFromCheckoutSession(
  supabaseAdmin: SupabaseClient,
  session: Stripe.Checkout.Session
): Promise<string | null> {
  const metadata = (session.metadata ?? null) as Record<string, unknown> | null;
  const fromMd = pickTaxiRideIdFromMetadata(metadata);
  if (fromMd) return fromMd;

  if (!isTaxiStripeModule(metadata)) return null;

  const clientRef = String(session.client_reference_id ?? "").trim();
  if (!clientRef) return null;

  const { data } = await supabaseAdmin
    .from("taxi_rides")
    .select("id")
    .eq("id", clientRef)
    .maybeSingle<{ id: string }>();

  return data?.id ?? clientRef;
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
      (!isTaxiStripeModule(metadata) && session.client_reference_id
        ? String(session.client_reference_id).trim()
        : null);

    const deliveryRequestId = pickDeliveryRequestIdFromMetadata(metadata);
    const taxiRideId = await resolveTaxiRideIdFromCheckoutSession(
      supabaseAdmin,
      session
    );

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

    if (taxiRideId && (await isTaxiRideUnpaid(supabaseAdmin, taxiRideId))) {
      return true;
    }

    return false;
  }

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent;
    const metadata = (pi.metadata ?? null) as Record<string, unknown> | null;
    const paymentIntentId = String(pi.id ?? "").trim();

    if (!paymentIntentId) return false;

    if (isDriverTipPaymentIntent(metadata)) {
      const tipOrderId = pickOrderIdFromMetadata(metadata);
      if (tipOrderId) {
        return isOrderTipUntransferred(supabaseAdmin, tipOrderId);
      }
      const tipRideId = pickTaxiRideIdFromTipMetadata(metadata);
      if (tipRideId) {
        return isTaxiRideTipUntransferred(supabaseAdmin, tipRideId);
      }
      return false;
    }

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

    const taxiRideId = await resolveTaxiRideIdForPaymentIntent(
      supabaseAdmin,
      paymentIntentId,
      metadata
    );

    if (taxiRideId && (await isTaxiRideUnpaid(supabaseAdmin, taxiRideId))) {
      return true;
    }

    return false;
  }

  // Identity: reprocess when the audit row for this Stripe event is missing
  // (crash after stripe_webhook_events insert, before applyProviderSessionSnapshot).
  if (String(event.type).startsWith("identity.verification_session.")) {
    const { data } = await supabaseAdmin
      .from("identity_verification_events")
      .select("id")
      .eq("provider", "stripe_identity")
      .eq("provider_event_id", event.id)
      .limit(1);
    return (data ?? []).length === 0;
  }

  return false;
}
