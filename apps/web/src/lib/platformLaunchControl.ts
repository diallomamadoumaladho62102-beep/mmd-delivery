import type { SupabaseClient } from "@supabase/supabase-js";
import {
  inferPlatformCountryCode,
  normalizePlatformCountryCode,
} from "@/lib/platformCountryInference";

export {
  AFRICA_PLATFORM_COUNTRIES,
  detectPlatformCountryFromCoordinates,
  inferPlatformCountryCode,
  isAfricaPlatformCountry,
  normalizePlatformCountryCode,
  normalizeStripeConnectCountry,
  pricingConfigKeyForOrder,
} from "@/lib/platformCountryInference";

export type PlatformLaunchStatus = "enabled" | "disabled" | "maintenance";

export type PlatformVertical = "platform" | "taxi" | "delivery" | "restaurant";

export type PlatformFeature = "active" | "checkout" | "payout";

export type PlatformCountryConfig = {
  id: string;
  country_code: string;
  country_name: string;
  continent: string | null;
  region: string | null;
  platform_enabled: boolean;
  taxi_enabled: boolean;
  delivery_enabled: boolean;
  restaurant_enabled: boolean;
  marketplace_enabled: boolean;
  seller_enabled: boolean;
  checkout_enabled: boolean;
  payout_enabled: boolean;
  maintenance_mode: boolean;
  launch_status: PlatformLaunchStatus;
  created_at: string;
  updated_at: string;
};

export type PlatformFeatureResult =
  | { ok: true; country_code: string }
  | { ok: false; error: string; message: string; country_code?: string };

const PLATFORM_SELECT =
  "id, country_code, country_name, continent, region, platform_enabled, taxi_enabled, delivery_enabled, restaurant_enabled, marketplace_enabled, seller_enabled, checkout_enabled, payout_enabled, maintenance_mode, launch_status, created_at, updated_at";

export async function fetchPlatformCountryConfig(
  supabase: SupabaseClient,
  countryCode: string
): Promise<PlatformCountryConfig | null> {
  const code = normalizePlatformCountryCode(countryCode);
  if (!code) return null;

  const { data, error } = await supabase
    .from("platform_countries")
    .select(PLATFORM_SELECT)
    .eq("country_code", code)
    .maybeSingle<PlatformCountryConfig>();

  if (error || !data) return null;
  return data;
}

export function assertPlatformFeatureFromConfig(
  config: PlatformCountryConfig,
  vertical: PlatformVertical,
  feature: PlatformFeature
): PlatformFeatureResult {
  const countryCode = config.country_code;

  if (config.maintenance_mode || config.launch_status === "maintenance") {
    return {
      ok: false,
      error: "platform_maintenance",
      message: `MMD platform in ${countryCode} is under maintenance`,
      country_code: countryCode,
    };
  }

  if (!config.platform_enabled) {
    return {
      ok: false,
      error: "platform_disabled",
      message: `MMD platform is not available in ${countryCode}`,
      country_code: countryCode,
    };
  }

  if (vertical === "platform" && feature === "active") {
    return { ok: true, country_code: countryCode };
  }

  if (vertical === "taxi" && !config.taxi_enabled) {
    return {
      ok: false,
      error: "platform_taxi_disabled",
      message: `Taxi is not enabled in ${countryCode}`,
      country_code: countryCode,
    };
  }

  if (vertical === "delivery" && !config.delivery_enabled) {
    return {
      ok: false,
      error: "platform_delivery_disabled",
      message: `Delivery is not enabled in ${countryCode}`,
      country_code: countryCode,
    };
  }

  if (vertical === "restaurant" && !config.restaurant_enabled) {
    return {
      ok: false,
      error: "platform_restaurant_disabled",
      message: `Restaurant is not enabled in ${countryCode}`,
      country_code: countryCode,
    };
  }

  if (feature === "checkout" && !config.checkout_enabled) {
    return {
      ok: false,
      error: "platform_checkout_disabled",
      message: `Checkout is not enabled in ${countryCode}`,
      country_code: countryCode,
    };
  }

  if (feature === "payout" && !config.payout_enabled) {
    return {
      ok: false,
      error: "platform_payout_disabled",
      message: `Payouts are not enabled in ${countryCode}`,
      country_code: countryCode,
    };
  }

  if (feature !== "active" && feature !== "checkout" && feature !== "payout") {
    return {
      ok: false,
      error: "platform_feature_invalid",
      message: `Invalid platform feature: ${feature}`,
      country_code: countryCode,
    };
  }

  return { ok: true, country_code: countryCode };
}

export async function assertPlatformFeature(
  supabase: SupabaseClient,
  countryCode: string,
  vertical: PlatformVertical,
  feature: PlatformFeature
): Promise<PlatformFeatureResult> {
  const code = normalizePlatformCountryCode(countryCode);
  const config = await fetchPlatformCountryConfig(supabase, code);

  if (!config) {
    return {
      ok: false,
      error: "platform_country_not_configured",
      message: `Platform country ${code} is not configured`,
      country_code: code,
    };
  }

  return assertPlatformFeatureFromConfig(config, vertical, feature);
}

export async function assertPlatformFeatureOrSkip(
  supabase: SupabaseClient,
  countryCode: string,
  vertical: PlatformVertical,
  feature: PlatformFeature
): Promise<PlatformFeatureResult | null> {
  const config = await fetchPlatformCountryConfig(
    supabase,
    normalizePlatformCountryCode(countryCode)
  );
  if (!config) return null;
  return assertPlatformFeatureFromConfig(config, vertical, feature);
}
