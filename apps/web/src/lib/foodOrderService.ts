import type { SupabaseClient } from "@supabase/supabase-js";
import { logDeliveryPricingV2Shadow } from "@/lib/deliveryPricingEngine";
import {
  computeFoodOrderPricing,
  loadRestaurantMenuLines,
  roundFoodMoney,
  toFiniteFoodNumber,
  type FoodOrderLineInput,
  type FoodOrderPricingResult,
} from "@/lib/foodOrderServerPricing";
import { inferPlatformCountryCode } from "@/lib/platformLaunchControl";

export type CreateFoodOrderInput = {
  supabaseAdmin: SupabaseClient;
  clientId: string;
  restaurantUserId: string;
  restaurantName: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  items: FoodOrderLineInput[];
  countryCode: string;
  promoCode?: string | null;
  leaveAtDoor?: boolean;
};

export type CreateFoodOrderResult = FoodOrderPricingResult & {
  orderId: string;
  commissions: Record<string, unknown> | null;
};

function buildItemsJson(pricing: FoodOrderPricingResult) {
  return pricing.items.map((line) => ({
    item_id: line.item_id,
    name: line.name,
    category: line.category,
    quantity: line.quantity,
    unit_price: line.unit_price,
    line_total: line.line_total,
    options: line.options ?? null,
  }));
}

export async function createFoodOrderServerSide(
  input: CreateFoodOrderInput
): Promise<CreateFoodOrderResult> {
  const {
    supabaseAdmin,
    clientId,
    restaurantUserId,
    restaurantName,
    pickupAddress,
    pickupLat,
    pickupLng,
    dropoffAddress,
    dropoffLat,
    dropoffLng,
    items,
    countryCode,
    promoCode,
  } = input;

  if (!clientId) throw new Error("clientId manquant");
  if (!restaurantUserId) throw new Error("restaurantUserId manquant");
  if (!restaurantName?.trim()) throw new Error("restaurantName manquant");
  if (!pickupAddress?.trim() || !dropoffAddress?.trim()) {
    throw new Error("Adresse pickup/dropoff manquante");
  }

  const pricing = await computeFoodOrderPricing({
    supabaseAdmin,
    restaurantUserId,
    items,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    countryCode,
    promoCode,
  });

  const pickupCode = Math.random().toString(36).slice(2, 8).toUpperCase();
  const dropoffCode = Math.floor(100000 + Math.random() * 900000).toString();

  const { data, error } = await supabaseAdmin
    .from("orders")
    .insert({
      created_by: clientId,
      client_id: clientId,
      user_id: clientId,
      client_user_id: clientId,
      kind: "food",
      order_type: "food",
      pickup_kind: "restaurant",
      restaurant_id: restaurantUserId,
      restaurant_user_id: restaurantUserId,
      restaurant_name: restaurantName.trim(),
      pickup_address: pickupAddress.trim(),
      dropoff_address: dropoffAddress.trim(),
      pickup_lat: pickupLat,
      pickup_lng: pickupLng,
      dropoff_lat: dropoffLat,
      dropoff_lng: dropoffLng,
      pickup_code: pickupCode,
      dropoff_code: dropoffCode,
      subtotal: pricing.subtotal,
      tax: pricing.tax,
      discounts: pricing.discounts,
      total: pricing.total,
      // Feed generated grand_total (items_subtotal + tax_amount + delivery_fee - discounts)
      items_subtotal: pricing.subtotal,
      tax_amount: pricing.tax,
      // grand_total and total_cents are GENERATED ALWAYS in production.
      // Inserting either raises: cannot insert a non-DEFAULT value into column "...".
      // total_cents = GREATEST(0, subtotal_cents + delivery_fee_cents + taxes_cents)
      subtotal_cents: Math.round(pricing.subtotal * 100),
      delivery_fee_cents: Math.round(pricing.deliveryFee * 100),
      taxes_cents: Math.round(pricing.tax * 100),
      tax_cents: Math.round(pricing.tax * 100),
      service_fee: pricing.serviceFee,
      service_fee_cents: pricing.serviceFeeCents,
      service_fee_pct: pricing.serviceFeePct,
      service_fee_enabled: pricing.serviceFeeEnabled,
      service_fee_fixed_cents: pricing.serviceFeeFixedCents,
      currency: pricing.currency,
      promo_code_applied: pricing.promoCodeApplied,
      promo_type_applied: pricing.promoTypeApplied,
      promo_value_applied: pricing.promoValueApplied,
      promo_discount_amount: pricing.promoDiscountAmount,
      delivery_discount_amount: pricing.deliveryDiscountAmount,
      status: "pending",
      payment_status: "unpaid",
      items_json: buildItemsJson(pricing),
      distance_miles_est: pricing.distanceMiles,
      eta_minutes_est: pricing.etaMinutes,
      delivery_fee_est: pricing.deliveryFeeRaw,
      distance_miles: pricing.distanceMiles,
      eta_minutes: pricing.etaMinutes,
      delivery_fee: pricing.deliveryFee,
      delivery_pay: pricing.driverPayoutEstimate,
      leave_at_door: input.leaveAtDoor === true,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const orderId = String(data.id);

  await supabaseAdmin.from("order_members").upsert(
    [
      { order_id: orderId, user_id: clientId, role: "client" },
      { order_id: orderId, user_id: restaurantUserId, role: "restaurant" },
    ],
    { onConflict: "order_id,user_id", ignoreDuplicates: false }
  );

  void logDeliveryPricingV2Shadow({
    sourceType: "food_order",
    sourceId: orderId,
    countryCode: pricing.countryCode,
    v1Pricing: {
      deliveryFee: pricing.deliveryFeeRaw,
      driverPayout: pricing.driverPayoutEstimate,
      platformFee: roundFoodMoney(pricing.deliveryFeeRaw - pricing.driverPayoutEstimate),
    },
    distanceMiles: pricing.distanceMiles,
    durationMinutes: pricing.etaMinutes,
    inputs: {
      path: "createFoodOrderServerSide",
      currency: pricing.currency,
      configKey: pricing.configKey,
      taxSource: pricing.taxSource,
      serviceFee: pricing.serviceFee,
    },
  });

  const { data: commissionData, error: commissionErr } = await supabaseAdmin.rpc(
    "refresh_order_commissions",
    { p_order_id: orderId }
  );

  if (commissionErr) {
    // Do not leave a half-created unpaid food order when commission math fails.
    // Operational fulfillment still requires Stripe payment_status=paid.
    await supabaseAdmin.from("order_members").delete().eq("order_id", orderId);
    await supabaseAdmin.from("orders").delete().eq("id", orderId);
    throw new Error(`Commission refresh failed: ${commissionErr.message}`);
  }

  return {
    ...pricing,
    orderId,
    commissions:
      commissionData && typeof commissionData === "object"
        ? (commissionData as Record<string, unknown>)
        : null,
  };
}

type StoredOrderRow = {
  id: string;
  kind: string | null;
  order_type: string | null;
  restaurant_user_id: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  grand_total: number | null;
  total_cents: number | null;
  currency: string | null;
  delivery_fee: number | null;
  items_json: unknown;
  promo_code_applied: string | null;
};

function parseStoredFoodLines(itemsJson: unknown): FoodOrderLineInput[] {
  if (!Array.isArray(itemsJson)) return [];

  const lines: FoodOrderLineInput[] = [];

  for (const raw of itemsJson) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const itemId = String(row.item_id ?? row.menu_item_id ?? "").trim();
    const quantity = toFiniteFoodNumber(row.quantity);

    if (!itemId || !Number.isInteger(quantity) || quantity <= 0) continue;

    lines.push({
      item_id: itemId,
      quantity,
      options: row.options ?? null,
    });
  }

  return lines;
}

export async function validateFoodOrderBeforeCheckout(
  supabaseAdmin: SupabaseClient,
  orderId: string
): Promise<{ ok: true; pricing: FoodOrderPricingResult } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(
      "id, kind, order_type, restaurant_user_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, subtotal, tax, total, grand_total, total_cents, currency, delivery_fee, items_json, promo_code_applied"
    )
    .eq("id", orderId)
    .maybeSingle<StoredOrderRow>();

  if (error || !data) {
    return { ok: false, error: "order_not_found" };
  }

  const restaurantUserId = String(data.restaurant_user_id ?? "").trim();
  if (!restaurantUserId) {
    return { ok: false, error: "restaurant_missing" };
  }

  const lines = parseStoredFoodLines(data.items_json);
  if (lines.length === 0) {
    return { ok: false, error: "order_items_not_server_priced" };
  }

  const countryCode = inferPlatformCountryCode({
    currency: data.currency,
    lat: data.dropoff_lat,
    lng: data.dropoff_lng,
  });

  const pricing = await computeFoodOrderPricing({
    supabaseAdmin,
    restaurantUserId,
    items: lines,
    pickupLat: toFiniteFoodNumber(data.pickup_lat),
    pickupLng: toFiniteFoodNumber(data.pickup_lng),
    dropoffLat: toFiniteFoodNumber(data.dropoff_lat),
    dropoffLng: toFiniteFoodNumber(data.dropoff_lng),
    countryCode,
    promoCode: data.promo_code_applied,
  });

  const storedTotal = roundFoodMoney(
    toFiniteFoodNumber(data.grand_total, toFiniteFoodNumber(data.total))
  );
  const delta = Math.abs(storedTotal - pricing.total);

  if (delta > 0.02) {
    return {
      ok: false,
      error: `food_order_pricing_mismatch: stored=${storedTotal} expected=${pricing.total}`,
    };
  }

  const storedCurrency = String(data.currency ?? "").trim().toUpperCase();
  if (storedCurrency && storedCurrency !== pricing.currency) {
    return {
      ok: false,
      error: `food_order_currency_mismatch: stored=${storedCurrency} expected=${pricing.currency}`,
    };
  }

  return { ok: true, pricing };
}

export async function quoteFoodOrderServerSide(
  input: Omit<CreateFoodOrderInput, "clientId" | "restaurantName" | "pickupAddress" | "dropoffAddress">
) {
  return computeFoodOrderPricing({
    supabaseAdmin: input.supabaseAdmin,
    restaurantUserId: input.restaurantUserId,
    items: input.items,
    pickupLat: input.pickupLat,
    pickupLng: input.pickupLng,
    dropoffLat: input.dropoffLat,
    dropoffLng: input.dropoffLng,
    countryCode: input.countryCode,
    promoCode: input.promoCode,
  });
}

export { loadRestaurantMenuLines };
