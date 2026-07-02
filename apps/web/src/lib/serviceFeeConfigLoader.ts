import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseServiceFeeConfig,
  type ServiceFeeConfig,
} from "@/lib/clientServiceFee";
import { pricingConfigKeyForOrder } from "@/lib/platformCountryInference";

const PRICING_SERVICE_FEE_SELECT =
  "service_fee_enabled, service_fee_pct, service_fee_fixed_cents, client_pct, fixed_client_fee";

const TAXI_SERVICE_FEE_SELECT =
  "service_fee_enabled, service_fee_pct, service_fee_fixed_cents";

export async function loadFoodServiceFeeConfig(
  supabaseAdmin: SupabaseClient,
  params: {
    countryCode: string;
    currency: string;
    lat?: number;
    lng?: number;
  }
): Promise<ServiceFeeConfig> {
  const configKey = pricingConfigKeyForOrder({
    orderType: "food",
    countryCode: params.countryCode,
    currency: params.currency,
    lat: params.lat,
    lng: params.lng,
  });

  const { data, error } = await supabaseAdmin
    .from("pricing_config")
    .select(PRICING_SERVICE_FEE_SELECT)
    .eq("config_key", configKey)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Service fee config lookup failed: ${error.message}`);
  }

  return parseServiceFeeConfig(data);
}

export async function loadErrandServiceFeeConfig(
  supabaseAdmin: SupabaseClient,
  params: {
    countryCode: string;
    currency: string;
    lat?: number;
    lng?: number;
  }
): Promise<ServiceFeeConfig> {
  const configKey = pricingConfigKeyForOrder({
    orderType: "errand",
    countryCode: params.countryCode,
    currency: params.currency,
    lat: params.lat,
    lng: params.lng,
  });

  const { data, error } = await supabaseAdmin
    .from("pricing_config")
    .select(PRICING_SERVICE_FEE_SELECT)
    .eq("config_key", configKey)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Service fee config lookup failed: ${error.message}`);
  }

  return parseServiceFeeConfig(data);
}

export async function loadMarketplaceServiceFeeConfig(
  supabaseAdmin: SupabaseClient,
  params?: { countryCode?: string; region?: string }
): Promise<ServiceFeeConfig> {
  const keys = [
    params?.countryCode && params?.region
      ? `marketplace_${String(params.region).toLowerCase()}`
      : null,
    params?.countryCode
      ? `marketplace_${String(params.countryCode).toLowerCase()}`
      : null,
    "marketplace_default",
  ].filter(Boolean) as string[];

  for (const configKey of keys) {
    const { data, error } = await supabaseAdmin
      .from("pricing_config")
      .select(PRICING_SERVICE_FEE_SELECT)
      .eq("config_key", configKey)
      .eq("active", true)
      .maybeSingle();

    if (error) {
      throw new Error(`Marketplace service fee lookup failed: ${error.message}`);
    }

    if (data) {
      return parseServiceFeeConfig(data);
    }
  }

  return { enabled: false, pct: 0, fixedCents: 0 };
}

export async function loadTaxiServiceFeeConfig(
  supabaseAdmin: SupabaseClient,
  params: { countryCode: string; vehicleClass: string }
): Promise<ServiceFeeConfig> {
  const countryCode = String(params.countryCode ?? "US").trim().toUpperCase();
  const vehicleClass = String(params.vehicleClass ?? "standard").trim().toLowerCase();

  const { data, error } = await supabaseAdmin
    .from("taxi_pricing")
    .select(TAXI_SERVICE_FEE_SELECT)
    .eq("country_code", countryCode)
    .eq("vehicle_class", vehicleClass)
    .eq("active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Taxi service fee lookup failed: ${error.message}`);
  }

  return parseServiceFeeConfig(data);
}
