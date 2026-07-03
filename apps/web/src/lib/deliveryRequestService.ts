import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeDeliveryRequestPricing,
  type DeliveryRequestPricingResult,
} from "@/lib/deliveryRequestServerPricing";
import { inferPlatformCountryCode } from "@/lib/platformLaunchControl";
import { roundPlatformMoney } from "@/lib/platformCurrency";

function toFiniteNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export type CreateDeliveryRequestInput = {
  supabaseAdmin: SupabaseClient;
  clientId: string;
  requestType: "package" | "ride";
  title: string;
  description?: string | null;
  pickupAddress: string;
  dropoffAddress: string;
  pickupContactName?: string | null;
  pickupPhone?: string | null;
  dropoffContactName?: string | null;
  dropoffPhone?: string | null;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  dropoffLocationId?: string | null;
  countryCode: string;
  promoCode?: string | null;
  leaveAtDoor?: boolean;
};

export type CreateDeliveryRequestResult = DeliveryRequestPricingResult & {
  deliveryRequestId: string;
};

export async function createDeliveryRequestServerSide(
  input: CreateDeliveryRequestInput
): Promise<CreateDeliveryRequestResult> {
  const pricing = await computeDeliveryRequestPricing({
    supabaseAdmin: input.supabaseAdmin,
    pickupLat: input.pickupLat,
    pickupLng: input.pickupLng,
    dropoffLat: input.dropoffLat,
    dropoffLng: input.dropoffLng,
    countryCode: input.countryCode,
    promoCode: input.promoCode,
    subtotal: 0,
  });

  const pickupCode = Math.random().toString(36).slice(2, 8).toUpperCase();
  const dropoffCode = Math.floor(100000 + Math.random() * 900000).toString();

  const { data, error } = await input.supabaseAdmin
    .from("delivery_requests")
    .insert({
      created_by: input.clientId,
      client_user_id: input.clientId,
      status: "pending",
      payment_status: "unpaid",
      kind: "delivery",
      request_type: input.requestType,
      title: input.title.trim(),
      errand_description: input.description?.trim() || null,
      pickup_address: input.pickupAddress.trim(),
      dropoff_address: input.dropoffAddress.trim(),
      pickup_contact_name: input.pickupContactName?.trim() || null,
      pickup_phone: input.pickupPhone?.trim() || null,
      dropoff_contact_name: input.dropoffContactName?.trim() || null,
      dropoff_phone: input.dropoffPhone?.trim() || null,
      pickup_lat: input.pickupLat,
      pickup_lng: input.pickupLng,
      dropoff_lat: input.dropoffLat,
      dropoff_lng: input.dropoffLng,
      dropoff_location_id: input.dropoffLocationId ?? null,
      pickup_code: pickupCode,
      dropoff_code: dropoffCode,
      distance_miles: pricing.distanceMiles,
      eta_minutes: pricing.etaMinutes,
      subtotal: pricing.subtotal,
      delivery_fee: pricing.deliveryFee,
      tax: pricing.tax,
      service_fee: pricing.serviceFee,
      service_fee_cents: pricing.serviceFeeCents,
      service_fee_pct: pricing.serviceFeePct,
      service_fee_enabled: pricing.serviceFeeEnabled,
      service_fee_fixed_cents: pricing.serviceFeeFixedCents,
      total: pricing.total,
      total_cents: pricing.totalCents,
      currency: pricing.currency,
      leave_at_door: input.leaveAtDoor === true,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return {
    ...pricing,
    deliveryRequestId: String(data.id),
  };
}

type StoredDeliveryRequestRow = {
  id: string;
  created_by: string | null;
  client_user_id: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  total_cents: number | null;
  currency: string | null;
  delivery_fee: number | null;
  payment_status: string | null;
  promo_code_applied: string | null;
};

export async function validateDeliveryRequestBeforeCheckout(
  supabaseAdmin: SupabaseClient,
  deliveryRequestId: string
): Promise<{ ok: true; pricing: DeliveryRequestPricingResult } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin
    .from("delivery_requests")
    .select(
      "id, created_by, client_user_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, subtotal, tax, total, currency, delivery_fee, payment_status"
    )
    .eq("id", deliveryRequestId)
    .maybeSingle<StoredDeliveryRequestRow>();

  if (error || !data) {
    return { ok: false, error: "delivery_request_not_found" };
  }

  const countryCode = inferPlatformCountryCode({
    currency: data.currency,
    lat: data.dropoff_lat,
    lng: data.dropoff_lng,
  });

  const pricing = await computeDeliveryRequestPricing({
    supabaseAdmin,
    pickupLat: toFiniteNumber(data.pickup_lat),
    pickupLng: toFiniteNumber(data.pickup_lng),
    dropoffLat: toFiniteNumber(data.dropoff_lat),
    dropoffLng: toFiniteNumber(data.dropoff_lng),
    countryCode,
    promoCode: null,
    subtotal: toFiniteNumber(data.subtotal),
  });

  const storedTotal = roundPlatformMoney(
    toFiniteNumber(data.total)
  );
  const delta = Math.abs(storedTotal - pricing.total);

  if (delta > 0.02) {
    return {
      ok: false,
      error: `delivery_request_pricing_mismatch: stored=${storedTotal} expected=${pricing.total}`,
    };
  }

  const storedCurrency = String(data.currency ?? "").trim().toUpperCase();
  if (storedCurrency && storedCurrency !== pricing.currency) {
    return {
      ok: false,
      error: `delivery_request_currency_mismatch: stored=${storedCurrency} expected=${pricing.currency}`,
    };
  }

  return { ok: true, pricing };
}

export async function syncPaidDeliveryRequestOrder(
  supabaseAdmin: SupabaseClient,
  deliveryRequestId: string,
  clientId: string
): Promise<{ ok: true; orderId: string } | { ok: false; error: string }> {
  const { data: delivery, error } = await supabaseAdmin
    .from("delivery_requests")
    .select(
      "id, created_by, client_user_id, payment_status, paid_at, pickup_address, dropoff_address, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, distance_miles, delivery_fee, total, currency"
    )
    .eq("id", deliveryRequestId)
    .maybeSingle();

  if (error || !delivery) {
    return { ok: false, error: "delivery_request_not_found" };
  }

  const ownerId = String(delivery.client_user_id ?? delivery.created_by ?? "").trim();
  if (ownerId !== clientId) {
    return { ok: false, error: "forbidden" };
  }

  if (String(delivery.payment_status ?? "").toLowerCase() !== "paid") {
    return { ok: false, error: "payment_not_confirmed" };
  }

  const { data: existingOrder } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("external_ref_id", deliveryRequestId)
    .eq("external_ref_type", "delivery_request")
    .maybeSingle();

  if (existingOrder?.id) {
    return { ok: true, orderId: String(existingOrder.id) };
  }

  const nowIso = new Date().toISOString();
  const { data: orderData, error: orderError } = await supabaseAdmin
    .from("orders")
    .insert({
      kind: "pickup_dropoff",
      status: "pending",
      payment_status: "paid",
      paid_at: delivery.paid_at ?? nowIso,
      driver_id: null,
      created_by: delivery.created_by ?? clientId,
      client_id: delivery.client_user_id ?? delivery.created_by ?? clientId,
      user_id: delivery.client_user_id ?? delivery.created_by ?? clientId,
      client_user_id: delivery.client_user_id ?? delivery.created_by ?? clientId,
      pickup_address: delivery.pickup_address,
      dropoff_address: delivery.dropoff_address,
      pickup_lat: delivery.pickup_lat,
      pickup_lng: delivery.pickup_lng,
      dropoff_lat: delivery.dropoff_lat,
      dropoff_lng: delivery.dropoff_lng,
      distance_miles: delivery.distance_miles,
      delivery_fee: delivery.delivery_fee,
      total: delivery.total,
      currency: delivery.currency,
      external_ref_id: delivery.id,
      external_ref_type: "delivery_request",
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("id")
    .single();

  if (orderError || !orderData?.id) {
    return { ok: false, error: orderError?.message ?? "order_create_failed" };
  }

  const orderId = String(orderData.id);

  await supabaseAdmin.from("order_members").upsert(
    [{ order_id: orderId, user_id: clientId, role: "client" }],
    { onConflict: "order_id,user_id", ignoreDuplicates: false }
  );

  return { ok: true, orderId };
}

export async function quoteDeliveryRequestServerSide(
  input: Omit<CreateDeliveryRequestInput, "clientId" | "title" | "description" | "pickupAddress" | "dropoffAddress" | "requestType">
) {
  return computeDeliveryRequestPricing({
    supabaseAdmin: input.supabaseAdmin,
    pickupLat: input.pickupLat,
    pickupLng: input.pickupLng,
    dropoffLat: input.dropoffLat,
    dropoffLng: input.dropoffLng,
    countryCode: input.countryCode,
    promoCode: input.promoCode,
    subtotal: 0,
  });
}
