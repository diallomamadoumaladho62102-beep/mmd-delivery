import type { SupabaseClient } from "@supabase/supabase-js";
import { getDistanceAndEta } from "@/lib/mapboxRoute";
import {
  computeDeliveryPricing,
  type DeliveryPricingConfig,
} from "@/lib/deliveryPricing";
import { assertFoodCheckoutCurrencyAllowed } from "@/lib/foodCurrencyGuard";
import { computeFoodTaxAmount } from "@/lib/foodOrderServerPricing";
import {
  computeClientServiceFee,
  computeServiceFeeBaseAmount,
} from "@/lib/clientServiceFee";
import { loadErrandServiceFeeConfig } from "@/lib/serviceFeeConfigLoader";
import {
  assertPlatformFeature,
  inferPlatformCountryCode,
  pricingConfigKeyForOrder,
} from "@/lib/platformLaunchControl";
import {
  currencyForPlatformCountry,
  roundPlatformMoney,
} from "@/lib/platformCurrency";

type ComputeOrderPricingRow = {
  config_key: string;
  currency: string;
  subtotal: number;
  delivery_fee: number;
  promo_code_applied: string | null;
  promo_type_applied: string | null;
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
};

export type DeliveryRequestPricingInput = {
  supabaseAdmin: SupabaseClient;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  countryCode: string;
  promoCode?: string | null;
  subtotal?: number;
};

export type DeliveryRequestPricingResult = {
  countryCode: string;
  currency: string;
  configKey: string;
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
  promoDiscountAmount: number;
  discounts: number;
  subtotalAfterDiscount: number;
  total: number;
  totalCents: number;
  distanceMiles: number;
  etaMinutes: number;
  driverPayoutEstimate: number;
};

function toFiniteNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function validateCoordinates(lat: number, lng: number, prefix: string) {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error(`${prefix} latitude invalide`);
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error(`${prefix} longitude invalide`);
  }
}

function normalizePromoCode(value?: string | null) {
  const text = String(value ?? "").trim().toUpperCase();
  return text || null;
}

async function getActiveErrandDeliveryPricingConfig(
  supabaseAdmin: SupabaseClient,
  params: {
    countryCode: string;
    currency: string;
    lat?: number;
    lng?: number;
  }
): Promise<DeliveryPricingConfig & { configKey: string }> {
  const configKey = pricingConfigKeyForOrder({
    orderType: "errand",
    countryCode: params.countryCode,
    currency: params.currency,
    lat: params.lat,
    lng: params.lng,
  });

  const { data, error } = await supabaseAdmin
    .from("pricing_config")
    .select(
      "config_key, active, delivery_fee_base, delivery_fee_per_mile, delivery_fee_per_minute, delivery_platform_pct, delivery_driver_pct"
    )
    .eq("config_key", configKey)
    .eq("active", true)
    .maybeSingle<PricingConfigRow>();

  if (error || !data) {
    throw new Error(`Pricing config error: active ${configKey} config not found`);
  }

  return {
    configKey,
    baseFare: roundPlatformMoney(toFiniteNumber(data.delivery_fee_base, 2.5)),
    perMile: roundPlatformMoney(toFiniteNumber(data.delivery_fee_per_mile, 0.9)),
    perMinute: roundPlatformMoney(toFiniteNumber(data.delivery_fee_per_minute, 0.15)),
    minFare: 0,
    platformSharePct: roundPlatformMoney(toFiniteNumber(data.delivery_platform_pct, 20)),
  };
}

export async function computeDeliveryRequestPricing(
  input: DeliveryRequestPricingInput
): Promise<DeliveryRequestPricingResult> {
  const {
    supabaseAdmin,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    countryCode,
    promoCode,
    subtotal = 0,
  } = input;

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
    "delivery",
    "active"
  );
  if (platformCheck.ok === false) {
    throw new Error(platformCheck.message);
  }

  const checkoutCheck = await assertPlatformFeature(
    supabaseAdmin,
    platformCountry,
    "delivery",
    "checkout"
  );
  if (checkoutCheck.ok === false) {
    throw new Error(checkoutCheck.message);
  }

  const safeSubtotal = roundPlatformMoney(Math.max(toFiniteNumber(subtotal), 0));

  const { distanceMiles, etaMinutes } = await getDistanceAndEta(
    { lat: pickupLat, lng: pickupLng },
    { lat: dropoffLat, lng: dropoffLng }
  );

  const safeDistanceMiles = roundPlatformMoney(toFiniteNumber(distanceMiles));
  const safeEtaMinutes = Math.max(0, Math.round(toFiniteNumber(etaMinutes)));

  const deliveryPricingConfig = await getActiveErrandDeliveryPricingConfig(
    supabaseAdmin,
    {
      countryCode: platformCountry,
      currency,
      lat: dropoffLat,
      lng: dropoffLng,
    }
  );

  const deliveryPricing = computeDeliveryPricing(
    {
      distanceMiles: safeDistanceMiles,
      durationMinutes: safeEtaMinutes,
    },
    deliveryPricingConfig
  );

  const rawDeliveryFee = roundPlatformMoney(toFiniteNumber(deliveryPricing.deliveryFee));
  const driverPayoutEstimate = roundPlatformMoney(toFiniteNumber(deliveryPricing.driverPayout));
  const normalizedPromoCode = normalizePromoCode(promoCode);

  const { data: pricingData, error: pricingError } = await supabaseAdmin.rpc(
    "compute_order_pricing",
    {
      p_order_type: "errand",
      p_subtotal: safeSubtotal,
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

  const promoDiscountAmount = roundPlatformMoney(
    toFiniteNumber(pricingRow.promo_discount_amount)
  );
  const deliveryDiscountAmount = roundPlatformMoney(
    toFiniteNumber(pricingRow.delivery_discount_amount)
  );
  const subtotalAfterDiscount = roundPlatformMoney(
    toFiniteNumber(pricingRow.subtotal_after_discount, safeSubtotal)
  );
  const deliveryFeeAfterDiscount = roundPlatformMoney(
    toFiniteNumber(pricingRow.delivery_fee_after_discount, rawDeliveryFee)
  );

  const taxResult = await computeFoodTaxAmount(
    supabaseAdmin,
    platformCountry,
    subtotalAfterDiscount
  );

  const serviceFeeConfig = await loadErrandServiceFeeConfig(supabaseAdmin, {
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
  const discounts = roundPlatformMoney(promoDiscountAmount + deliveryDiscountAmount);
  const total = roundPlatformMoney(
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
    subtotal: safeSubtotal,
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
