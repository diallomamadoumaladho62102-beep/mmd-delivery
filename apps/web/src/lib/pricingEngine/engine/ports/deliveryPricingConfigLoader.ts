import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_DELIVERY_PRICING_CONFIG,
  requireDeliverySharePctPair,
  requirePositiveDeliveryFeeRates,
} from "@/lib/deliveryPricing";
import { pricingConfigKeyForOrder } from "@/lib/platformLaunchControl";
import type { DeliveryFeeV1Config } from "../compute/deliveryFeeV1";
import { roundMoney2 } from "../compute/money";

function toFinite(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export type PeDeliveryPricingConfig = Required<DeliveryFeeV1Config> & {
  configKey: string;
};

async function loadDeliveryPricingConfig(
  supabaseAdmin: SupabaseClient,
  params: {
    orderType: "food" | "errand";
    countryCode: string;
    currency: string;
    lat?: number;
    lng?: number;
  }
): Promise<PeDeliveryPricingConfig> {
  const configKey = pricingConfigKeyForOrder({
    orderType: params.orderType,
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
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Pricing config error: active ${configKey} config not found`);
  }

  const row = data as {
    delivery_fee_base: number | null;
    delivery_fee_per_mile: number | null;
    delivery_fee_per_minute: number | null;
    delivery_platform_pct: number | null;
    delivery_driver_pct: number | null;
  };

  const { driverSharePct, platformSharePct } = requireDeliverySharePctPair({
    delivery_driver_pct: row.delivery_driver_pct,
    delivery_platform_pct: row.delivery_platform_pct,
    configKey,
  });

  const baseFare = roundMoney2(
    row.delivery_fee_base == null
      ? DEFAULT_DELIVERY_PRICING_CONFIG.baseFare
      : toFinite(row.delivery_fee_base)
  );
  const perMile = roundMoney2(
    row.delivery_fee_per_mile == null
      ? DEFAULT_DELIVERY_PRICING_CONFIG.perMile
      : toFinite(row.delivery_fee_per_mile)
  );
  const perMinute = roundMoney2(
    row.delivery_fee_per_minute == null
      ? DEFAULT_DELIVERY_PRICING_CONFIG.perMinute
      : toFinite(row.delivery_fee_per_minute)
  );

  requirePositiveDeliveryFeeRates({ configKey, baseFare, perMile, perMinute });

  return {
    configKey,
    baseFare,
    perMile,
    perMinute,
    minFare: DEFAULT_DELIVERY_PRICING_CONFIG.minFare,
    driverSharePct,
    platformSharePct,
  };
}

export function loadFoodDeliveryPricingConfig(
  supabaseAdmin: SupabaseClient,
  params: {
    countryCode: string;
    currency: string;
    lat?: number;
    lng?: number;
  }
) {
  return loadDeliveryPricingConfig(supabaseAdmin, {
    orderType: "food",
    ...params,
  });
}

export function loadErrandDeliveryPricingConfig(
  supabaseAdmin: SupabaseClient,
  params: {
    countryCode: string;
    currency: string;
    lat?: number;
    lng?: number;
  }
) {
  return loadDeliveryPricingConfig(supabaseAdmin, {
    orderType: "errand",
    ...params,
  });
}
