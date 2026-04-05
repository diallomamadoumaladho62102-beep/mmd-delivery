"use server";

import { supabaseServer } from "@/lib/supabaseServer";
import { getDistanceAndEta } from "@/lib/mapboxRoute";
import {
  computeDeliveryPricing,
  type DeliveryPricingConfig,
} from "@/lib/deliveryPricing";

export type CartItem = {
  name: string;
  category?: string | null;
  quantity: number;
  unit_price: number;
};

type ComputeOrderPricingRow = {
  config_key: string;
  order_type: string;
  currency: string;
  subtotal: number;
  delivery_fee: number;
  promo_code_applied: string | null;
  promo_type_applied: "percent" | "fixed" | "free_delivery" | null;
  promo_value_applied: number | null;
  promo_discount_amount: number;
  delivery_discount_amount: number;
  subtotal_after_discount: number;
  delivery_fee_after_discount: number;
  total_before_discount: number;
  total_after_discount: number;
  total_cents: number;
};

type PricingConfigRow = {
  config_key: string;
  active: boolean;
  delivery_fee_base: number | null;
  delivery_fee_per_mile: number | null;
  delivery_fee_per_minute: number | null;
  delivery_platform_pct: number | null;
  delivery_driver_pct: number | null;
};

type CreateFoodOrderWithDeliveryArgs = {
  clientId: string;

  restaurantUserId?: string | null;
  restaurantName: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;

  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;

  items: CartItem[];
  subtotal: number;
  tax: number;
  currency?: string;

  promoCode?: string | null;
};

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function toFiniteNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizePromoCode(value?: string | null) {
  const text = String(value ?? "").trim().toUpperCase();
  return text || null;
}

function normalizeCurrency(value?: string | null) {
  const text = String(value ?? "USD").trim().toUpperCase();
  return text || "USD";
}

function validateNonNegative(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} invalide`);
  }
}

function validateCoordinates(lat: number, lng: number, prefix: string) {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error(`${prefix} latitude invalide`);
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error(`${prefix} longitude invalide`);
  }
}

function validateItems(items: CartItem[]) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Le panier est vide");
  }

  for (const item of items) {
    if (!item?.name || !String(item.name).trim()) {
      throw new Error("Un article du panier a un nom invalide");
    }

    const quantity = toFiniteNumber(item.quantity);
    const unitPrice = toFiniteNumber(item.unit_price);

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`Quantité invalide pour ${item.name}`);
    }

    if (unitPrice < 0) {
      throw new Error(`Prix invalide pour ${item.name}`);
    }
  }
}

async function getActiveFoodDeliveryPricingConfig(): Promise<DeliveryPricingConfig> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("pricing_config")
    .select(
      "config_key, active, delivery_fee_base, delivery_fee_per_mile, delivery_fee_per_minute, delivery_platform_pct, delivery_driver_pct"
    )
    .eq("config_key", "food_default")
    .eq("active", true)
    .maybeSingle<PricingConfigRow>();

  if (error) {
    console.error(
      "[createFoodOrderWithDelivery] pricing_config lookup failed",
      error
    );
    throw new Error(`Pricing config error: ${error.message}`);
  }

  if (!data) {
    throw new Error("Pricing config error: active food_default config not found");
  }

  const platformSharePct = round2(
    toFiniteNumber(data.delivery_platform_pct, 20)
  );
  const driverSharePct = round2(toFiniteNumber(data.delivery_driver_pct, 80));

  validateNonNegative(
    "delivery_fee_base",
    round2(toFiniteNumber(data.delivery_fee_base, 2.5))
  );
  validateNonNegative(
    "delivery_fee_per_mile",
    round2(toFiniteNumber(data.delivery_fee_per_mile, 0.9))
  );
  validateNonNegative(
    "delivery_fee_per_minute",
    round2(toFiniteNumber(data.delivery_fee_per_minute, 0.15))
  );

  if (platformSharePct < 0 || platformSharePct > 100) {
    throw new Error("Pricing config error: delivery_platform_pct invalide");
  }

  if (driverSharePct < 0 || driverSharePct > 100) {
    throw new Error("Pricing config error: delivery_driver_pct invalide");
  }

  if (round2(platformSharePct + driverSharePct) > 100) {
    throw new Error(
      "Pricing config error: delivery_platform_pct + delivery_driver_pct > 100"
    );
  }

  return {
    baseFare: round2(toFiniteNumber(data.delivery_fee_base, 2.5)),
    perMile: round2(toFiniteNumber(data.delivery_fee_per_mile, 0.9)),
    perMinute: round2(toFiniteNumber(data.delivery_fee_per_minute, 0.15)),
    minFare: 0,
    platformSharePct,
  };
}

export async function createFoodOrderWithDelivery(
  args: CreateFoodOrderWithDeliveryArgs
) {
  const {
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
    subtotal,
    tax,
    currency = "USD",
    promoCode,
  } = args;

  if (!clientId) {
    throw new Error("clientId manquant");
  }

  if (!restaurantName?.trim()) {
    throw new Error("restaurantName manquant");
  }

  if (!pickupAddress?.trim() || !dropoffAddress?.trim()) {
    throw new Error("Adresse pickup/dropoff manquante");
  }

  validateCoordinates(pickupLat, pickupLng, "Pickup");
  validateCoordinates(dropoffLat, dropoffLng, "Dropoff");
  validateItems(items);

  const safeSubtotal = round2(toFiniteNumber(subtotal));
  const safeTax = round2(toFiniteNumber(tax));
  const safeCurrency = normalizeCurrency(currency);
  const normalizedPromoCode = normalizePromoCode(promoCode);

  validateNonNegative("subtotal", safeSubtotal);
  validateNonNegative("tax", safeTax);

  const supabase = await supabaseServer();

  // 1) Distance + ETA
  const { distanceMiles, etaMinutes } = await getDistanceAndEta(
    { lat: pickupLat, lng: pickupLng },
    { lat: dropoffLat, lng: dropoffLng }
  );

  const safeDistanceMiles = round2(toFiniteNumber(distanceMiles));
  const safeEtaMinutes = Math.max(0, Math.round(toFiniteNumber(etaMinutes)));

  validateNonNegative("distanceMiles", safeDistanceMiles);
  validateNonNegative("etaMinutes", safeEtaMinutes);

  // 2) Load active delivery pricing config from pricing_config
  const deliveryPricingConfig = await getActiveFoodDeliveryPricingConfig();

  // 3) Compute raw delivery fee using active admin config
  const deliveryPricing = computeDeliveryPricing(
    {
      distanceMiles: safeDistanceMiles,
      durationMinutes: safeEtaMinutes,
    },
    deliveryPricingConfig
  );

  const rawDeliveryFee = round2(toFiniteNumber(deliveryPricing.deliveryFee));
  const driverPayoutEstimate = round2(
    toFiniteNumber(deliveryPricing.driverPayout)
  );

  validateNonNegative("deliveryFee", rawDeliveryFee);
  validateNonNegative("driverPayout", driverPayoutEstimate);

  // 4) Promo + pricing engine in SQL
  const { data: pricingData, error: pricingError } = await supabase.rpc(
    "compute_order_pricing",
    {
      p_order_type: "food",
      p_subtotal: safeSubtotal,
      p_delivery_fee: rawDeliveryFee,
      p_currency: safeCurrency,
      p_promo_code: normalizedPromoCode,
    }
  );

  if (pricingError) {
    console.error("[createFoodOrderWithDelivery] compute_order_pricing failed", {
      message: pricingError.message,
      promoCode: normalizedPromoCode,
    });
    throw new Error(`Pricing error: ${pricingError.message}`);
  }

  const pricingRow = Array.isArray(pricingData)
    ? (pricingData[0] as ComputeOrderPricingRow | undefined)
    : undefined;

  if (!pricingRow) {
    throw new Error("Pricing error: no pricing row returned");
  }

  const promoDiscountAmount = round2(
    toFiniteNumber(pricingRow.promo_discount_amount)
  );
  const deliveryDiscountAmount = round2(
    toFiniteNumber(pricingRow.delivery_discount_amount)
  );
  const subtotalAfterDiscount = round2(
    toFiniteNumber(pricingRow.subtotal_after_discount, safeSubtotal)
  );
  const deliveryFeeAfterDiscount = round2(
    toFiniteNumber(pricingRow.delivery_fee_after_discount, rawDeliveryFee)
  );

  validateNonNegative("promo_discount_amount", promoDiscountAmount);
  validateNonNegative("delivery_discount_amount", deliveryDiscountAmount);
  validateNonNegative("subtotal_after_discount", subtotalAfterDiscount);
  validateNonNegative("delivery_fee_after_discount", deliveryFeeAfterDiscount);

  // 5) Frozen customer totals
  const discounts = round2(promoDiscountAmount + deliveryDiscountAmount);
  const total = round2(
    subtotalAfterDiscount + safeTax + deliveryFeeAfterDiscount
  );
  const grandTotal = total;
  const totalCents = Math.round(total * 100);

  // 6) Build items_json
  const itemsJson = items.map((it) => {
    const quantity = toFiniteNumber(it.quantity);
    const unitPrice = round2(toFiniteNumber(it.unit_price));

    return {
      name: String(it.name).trim(),
      category: it.category ?? null,
      quantity,
      unit_price: unitPrice,
      line_total: round2(unitPrice * quantity),
    };
  });

  // 7) Insert order with frozen promo/pricing fields
  const { data, error } = await supabase
    .from("orders")
    .insert({
      created_by: clientId,
      client_id: clientId,
      user_id: clientId,

      kind: "food",
      order_type: "food",
      pickup_kind: "restaurant",

      restaurant_id: restaurantUserId ?? null,
      restaurant_user_id: restaurantUserId ?? null,
      restaurant_name: restaurantName.trim(),

      pickup_address: pickupAddress.trim(),
      dropoff_address: dropoffAddress.trim(),

      pickup_contact_name: null,
      pickup_phone: null,
      dropoff_contact_name: null,
      dropoff_phone: null,

      pickup_lat: pickupLat,
      pickup_lng: pickupLng,
      dropoff_lat: dropoffLat,
      dropoff_lng: dropoffLng,

      subtotal: safeSubtotal,
      tax: safeTax,
      discounts,
      total,
      grand_total: grandTotal,
      total_cents: totalCents,
      currency: safeCurrency,

      promo_code_applied: pricingRow.promo_code_applied ?? null,
      promo_type_applied: pricingRow.promo_type_applied ?? null,
      promo_value_applied:
        pricingRow.promo_value_applied != null
          ? round2(toFiniteNumber(pricingRow.promo_value_applied))
          : null,
      promo_discount_amount: promoDiscountAmount,
      delivery_discount_amount: deliveryDiscountAmount,

      items_json: itemsJson,

      distance_miles_est: safeDistanceMiles,
      eta_minutes_est: safeEtaMinutes,
      delivery_fee_est: rawDeliveryFee,

      distance_miles: safeDistanceMiles,
      eta_minutes: safeEtaMinutes,
      delivery_fee: deliveryFeeAfterDiscount,
      delivery_pay: driverPayoutEstimate,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[createFoodOrderWithDelivery] insert order failed", error);
    throw new Error(error.message);
  }

  return {
    orderId: data.id as string,
    deliveryFee: deliveryFeeAfterDiscount,
    rawDeliveryFee,
    deliveryDiscountAmount,
    driverPayout: driverPayoutEstimate,
    promoCodeApplied: pricingRow.promo_code_applied ?? null,
    promoTypeApplied: pricingRow.promo_type_applied ?? null,
    promoValueApplied:
      pricingRow.promo_value_applied != null
        ? round2(toFiniteNumber(pricingRow.promo_value_applied))
        : null,
    promoDiscountAmount,
    discounts,
    subtotalAfterDiscount,
    total,
    totalCents,
    distanceMiles: safeDistanceMiles,
    etaMinutes: safeEtaMinutes,
  };
}