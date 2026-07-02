import type { SupabaseClient } from "@supabase/supabase-js";
import { getDistanceAndEta } from "@/lib/mapboxRoute";
import {
  computeDeliveryPricing,
  type DeliveryPricingConfig,
} from "@/lib/deliveryPricing";
import { assertFoodCheckoutCurrencyAllowed } from "@/lib/foodCurrencyGuard";
import {
  assertPlatformFeature,
  inferPlatformCountryCode,
  pricingConfigKeyForOrder,
} from "@/lib/platformLaunchControl";
import {
  computeClientServiceFee,
  computeServiceFeeBaseAmount,
} from "@/lib/clientServiceFee";
import { loadFoodServiceFeeConfig } from "@/lib/serviceFeeConfigLoader";
import {
  assertNoClientFoodPricingFields,
  currencyForPlatformCountry,
  FOOD_LEGACY_TAX_RATE,
  FORBIDDEN_CLIENT_FOOD_PRICING_FIELDS,
  roundFoodMoney,
} from "@/lib/foodOrderClientPricingGuard";

export {
  assertNoClientFoodPricingFields,
  currencyForPlatformCountry,
  FOOD_LEGACY_TAX_RATE,
  FORBIDDEN_CLIENT_FOOD_PRICING_FIELDS,
  roundFoodMoney,
};

export type FoodOrderLineInput = {
  item_id: string;
  quantity: number;
  options?: unknown;
};

export type ResolvedFoodMenuLine = {
  item_id: string;
  name: string;
  category: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  options?: unknown;
};

type RestaurantItemRow = {
  id: string;
  name: string;
  category: string | null;
  price_cents: number | null;
  is_available: boolean | null;
  restaurant_user_id: string;
};

type ComputeOrderPricingRow = {
  config_key: string;
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
  client_pct: number | null;
  delivery_fee_base: number | null;
  delivery_fee_per_mile: number | null;
  delivery_fee_per_minute: number | null;
  delivery_platform_pct: number | null;
  delivery_driver_pct: number | null;
  currency: string | null;
};

export type FoodOrderPricingInput = {
  supabaseAdmin: SupabaseClient;
  restaurantUserId: string;
  items: FoodOrderLineInput[];
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  countryCode: string;
  promoCode?: string | null;
};

export type FoodOrderPricingResult = {
  countryCode: string;
  currency: string;
  configKey: string;
  items: ResolvedFoodMenuLine[];
  subtotal: number;
  tax: number;
  taxRatePct: number;
  taxSource: string;
  serviceFee: number;
  serviceFeeCents: number;
  serviceFeePct: number;
  serviceFeeEnabled: boolean;
  serviceFeeFixedCents: number;
  deliveryFeeRaw: number;
  deliveryFee: number;
  deliveryDiscountAmount: number;
  promoCodeApplied: string | null;
  promoTypeApplied: string | null;
  promoValueApplied: number | null;
  promoDiscountAmount: number;
  discounts: number;
  subtotalAfterDiscount: number;
  total: number;
  totalCents: number;
  distanceMiles: number;
  etaMinutes: number;
  driverPayoutEstimate: number;
};

export function toFiniteFoodNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function normalizeFoodPromoCode(value?: string | null) {
  const text = String(value ?? "").trim().toUpperCase();
  return text || null;
}

function validateCoordinates(lat: number, lng: number, prefix: string) {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error(`${prefix} latitude invalide`);
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error(`${prefix} longitude invalide`);
  }
}

function validateLineInputs(items: FoodOrderLineInput[]) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Le panier est vide");
  }

  for (const item of items) {
    const itemId = String(item?.item_id ?? "").trim();
    const quantity = toFiniteFoodNumber(item?.quantity);

    if (!itemId) {
      throw new Error("item_id manquant dans le panier");
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`Quantité invalide pour ${itemId}`);
    }
  }
}

export async function loadRestaurantMenuLines(
  supabaseAdmin: SupabaseClient,
  restaurantUserId: string,
  items: FoodOrderLineInput[]
): Promise<ResolvedFoodMenuLine[]> {
  validateLineInputs(items);

  const itemIds = [...new Set(items.map((item) => String(item.item_id).trim()))];

  const { data, error } = await supabaseAdmin
    .from("restaurant_items")
    .select("id, name, category, price_cents, is_available, restaurant_user_id")
    .eq("restaurant_user_id", restaurantUserId)
    .in("id", itemIds);

  if (error) {
    throw new Error(`Menu lookup failed: ${error.message}`);
  }

  const byId = new Map<string, RestaurantItemRow>();
  for (const row of (data ?? []) as RestaurantItemRow[]) {
    byId.set(row.id, row);
  }

  const resolved: ResolvedFoodMenuLine[] = [];

  for (const line of items) {
    const itemId = String(line.item_id).trim();
    const fresh = byId.get(itemId);

    if (!fresh || fresh.is_available === false) {
      throw new Error(`Plat indisponible: ${itemId}`);
    }

    const quantity = toFiniteFoodNumber(line.quantity);
    const unitPrice = roundFoodMoney(toFiniteFoodNumber(fresh.price_cents) / 100);

    if (unitPrice < 0) {
      throw new Error(`Prix invalide pour ${fresh.name}`);
    }

    resolved.push({
      item_id: itemId,
      name: String(fresh.name ?? "").trim() || "Item",
      category: fresh.category ?? null,
      quantity,
      unit_price: unitPrice,
      line_total: roundFoodMoney(unitPrice * quantity),
      options: line.options ?? null,
    });
  }

  return resolved;
}

export async function computeFoodTaxAmount(
  supabaseAdmin: SupabaseClient,
  countryCode: string,
  taxableSubtotal: number
): Promise<{ tax: number; taxRatePct: number; taxSource: string }> {
  const safeSubtotal = roundFoodMoney(Math.max(taxableSubtotal, 0));
  const code = String(countryCode ?? "").trim().toUpperCase();

  const { data, error } = await supabaseAdmin
    .from("taxi_country_taxes")
    .select("tax_rate, applies_to, tax_name")
    .eq("country_code", code)
    .eq("active", true)
    .in("applies_to", ["food", "ride"]);

  if (error) {
    console.warn("[foodOrderServerPricing] taxi_country_taxes lookup failed", error.message);
  }

  const rows = (data ?? []) as Array<{
    tax_rate: number;
    applies_to: string;
    tax_name: string;
  }>;

  const foodRows = rows.filter((row) => row.applies_to === "food");
  const rideRows = rows.filter((row) => row.applies_to === "ride");
  const selected = foodRows.length > 0 ? foodRows : rideRows;

  if (selected.length > 0) {
    const taxRatePct = selected.reduce(
      (sum, row) => sum + toFiniteFoodNumber(row.tax_rate),
      0
    );
    const tax = roundFoodMoney(safeSubtotal * (taxRatePct / 100));
    const source =
      foodRows.length > 0 ? "taxi_country_taxes:food" : "taxi_country_taxes:ride";
    return { tax, taxRatePct: roundFoodMoney(taxRatePct), taxSource: source };
  }

  if (code === "US") {
    return {
      tax: roundFoodMoney(safeSubtotal * FOOD_LEGACY_TAX_RATE),
      taxRatePct: roundFoodMoney(FOOD_LEGACY_TAX_RATE * 100),
      taxSource: "legacy_us_food_rate",
    };
  }

  return { tax: 0, taxRatePct: 0, taxSource: "none" };
}

async function getActiveFoodDeliveryPricingConfig(
  supabaseAdmin: SupabaseClient,
  params: {
    countryCode: string;
    currency: string;
    lat?: number;
    lng?: number;
  }
): Promise<DeliveryPricingConfig & { configKey: string }> {
  const configKey = pricingConfigKeyForOrder({
    orderType: "food",
    countryCode: params.countryCode,
    currency: params.currency,
    lat: params.lat,
    lng: params.lng,
  });

  const { data, error } = await supabaseAdmin
    .from("pricing_config")
    .select(
      "config_key, active, delivery_fee_base, delivery_fee_per_mile, delivery_fee_per_minute, delivery_platform_pct, delivery_driver_pct, currency"
    )
    .eq("config_key", configKey)
    .eq("active", true)
    .maybeSingle<PricingConfigRow>();

  if (error || !data) {
    throw new Error(`Pricing config error: active ${configKey} config not found`);
  }

  return {
    configKey,
    baseFare: roundFoodMoney(toFiniteFoodNumber(data.delivery_fee_base, 2.5)),
    perMile: roundFoodMoney(toFiniteFoodNumber(data.delivery_fee_per_mile, 0.9)),
    perMinute: roundFoodMoney(toFiniteFoodNumber(data.delivery_fee_per_minute, 0.15)),
    minFare: 0,
    platformSharePct: roundFoodMoney(toFiniteFoodNumber(data.delivery_platform_pct, 20)),
  };
}

export async function computeFoodOrderPricing(
  input: FoodOrderPricingInput
): Promise<FoodOrderPricingResult> {
  const {
    supabaseAdmin,
    restaurantUserId,
    items,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    countryCode,
    promoCode,
  } = input;

  if (!restaurantUserId) {
    throw new Error("restaurantUserId manquant");
  }

  validateCoordinates(pickupLat, pickupLng, "Pickup");
  validateCoordinates(dropoffLat, dropoffLng, "Dropoff");

  const platformCountry = inferPlatformCountryCode({
    countryCode,
    lat: dropoffLat,
    lng: dropoffLng,
  });

  const currency = currencyForPlatformCountry(platformCountry, { strict: true });
  const currencyCheck = assertFoodCheckoutCurrencyAllowed(currency);
  if (currencyCheck.ok === false) {
    throw new Error(currencyCheck.message);
  }

  const platformCheck = await assertPlatformFeature(
    supabaseAdmin,
    platformCountry,
    "restaurant",
    "active"
  );
  if (platformCheck.ok === false) {
    throw new Error(platformCheck.message);
  }

  const checkoutCheck = await assertPlatformFeature(
    supabaseAdmin,
    platformCountry,
    "restaurant",
    "checkout"
  );
  if (checkoutCheck.ok === false) {
    throw new Error(checkoutCheck.message);
  }

  const menuLines = await loadRestaurantMenuLines(supabaseAdmin, restaurantUserId, items);
  const subtotal = roundFoodMoney(
    menuLines.reduce((sum, line) => sum + line.line_total, 0)
  );

  const { distanceMiles, etaMinutes } = await getDistanceAndEta(
    { lat: pickupLat, lng: pickupLng },
    { lat: dropoffLat, lng: dropoffLng }
  );

  const safeDistanceMiles = roundFoodMoney(toFiniteFoodNumber(distanceMiles));
  const safeEtaMinutes = Math.max(0, Math.round(toFiniteFoodNumber(etaMinutes)));

  const deliveryPricingConfig = await getActiveFoodDeliveryPricingConfig(supabaseAdmin, {
    countryCode: platformCountry,
    currency,
    lat: dropoffLat,
    lng: dropoffLng,
  });

  const deliveryPricing = computeDeliveryPricing(
    {
      distanceMiles: safeDistanceMiles,
      durationMinutes: safeEtaMinutes,
    },
    deliveryPricingConfig
  );

  const rawDeliveryFee = roundFoodMoney(toFiniteFoodNumber(deliveryPricing.deliveryFee));
  const driverPayoutEstimate = roundFoodMoney(toFiniteFoodNumber(deliveryPricing.driverPayout));
  const normalizedPromoCode = normalizeFoodPromoCode(promoCode);

  const { data: pricingData, error: pricingError } = await supabaseAdmin.rpc(
    "compute_order_pricing",
    {
      p_order_type: "food",
      p_subtotal: subtotal,
      p_delivery_fee: rawDeliveryFee,
      p_currency: currency,
      p_promo_code: normalizedPromoCode,
      p_country_code: platformCountry,
    }
  );

  if (pricingError) {
    throw new Error(`Pricing error: ${pricingError.message}`);
  }

  const pricingRow = Array.isArray(pricingData)
    ? (pricingData[0] as ComputeOrderPricingRow | undefined)
    : undefined;

  if (!pricingRow) {
    throw new Error("Pricing error: no pricing row returned");
  }

  const promoDiscountAmount = roundFoodMoney(
    toFiniteFoodNumber(pricingRow.promo_discount_amount)
  );
  const deliveryDiscountAmount = roundFoodMoney(
    toFiniteFoodNumber(pricingRow.delivery_discount_amount)
  );
  const subtotalAfterDiscount = roundFoodMoney(
    toFiniteFoodNumber(pricingRow.subtotal_after_discount, subtotal)
  );
  const deliveryFeeAfterDiscount = roundFoodMoney(
    toFiniteFoodNumber(pricingRow.delivery_fee_after_discount, rawDeliveryFee)
  );

  const taxResult = await computeFoodTaxAmount(
    supabaseAdmin,
    platformCountry,
    subtotalAfterDiscount
  );

  const serviceFeeConfig = await loadFoodServiceFeeConfig(supabaseAdmin, {
    countryCode: platformCountry,
    currency,
    lat: dropoffLat,
    lng: dropoffLng,
  });
  const serviceFeeBase = computeServiceFeeBaseAmount({
    subtotalAfterDiscount,
    deliveryFeeAfterDiscount,
  });
  const serviceFeeResult = computeClientServiceFee(serviceFeeConfig, serviceFeeBase);
  const discounts = roundFoodMoney(promoDiscountAmount + deliveryDiscountAmount);
  const total = roundFoodMoney(
    subtotalAfterDiscount +
      taxResult.tax +
      deliveryFeeAfterDiscount +
      serviceFeeResult.serviceFee
  );
  const totalCents = Math.round(total * 100);

  return {
    countryCode: platformCountry,
    currency,
    configKey: deliveryPricingConfig.configKey,
    items: menuLines,
    subtotal,
    tax: taxResult.tax,
    taxRatePct: taxResult.taxRatePct,
    taxSource: taxResult.taxSource,
    serviceFee: serviceFeeResult.serviceFee,
    serviceFeeCents: serviceFeeResult.serviceFeeCents,
    serviceFeePct: serviceFeeResult.pct,
    serviceFeeEnabled: serviceFeeResult.enabled,
    serviceFeeFixedCents: serviceFeeResult.fixedCents,
    deliveryFeeRaw: rawDeliveryFee,
    deliveryFee: deliveryFeeAfterDiscount,
    deliveryDiscountAmount,
    promoCodeApplied: pricingRow.promo_code_applied ?? null,
    promoTypeApplied: pricingRow.promo_type_applied ?? null,
    promoValueApplied:
      pricingRow.promo_value_applied != null
        ? roundFoodMoney(toFiniteFoodNumber(pricingRow.promo_value_applied))
        : null,
    promoDiscountAmount,
    discounts,
    subtotalAfterDiscount,
    total,
    totalCents,
    distanceMiles: safeDistanceMiles,
    etaMinutes: safeEtaMinutes,
    driverPayoutEstimate,
  };
}
