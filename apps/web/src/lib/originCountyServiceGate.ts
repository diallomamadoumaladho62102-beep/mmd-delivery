import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canDriverReceiveRequestsInCounty,
  canStartServiceInCounty,
  toggleConfigToCountySnapshot,
  type CanStartServiceResult,
  type CountyServiceKind,
  type CountyServiceToggleSnapshot,
} from "@/lib/canStartServiceInCounty";
import {
  detectUsCountyFromCoordinates,
  normalizeUsCountyCode,
} from "@/lib/platformCountyInference";
import { detectUsStateFromCoordinates } from "@/lib/platformCountryInference";
import {
  fetchPlatformCountyConfig,
  fetchPlatformScopeConfig,
  normalizeUsStateCode,
} from "@/lib/platformScopeResolver";
import type { PlatformScopeKey } from "@/lib/platformScopeTypes";
import { shouldApplyCountyCommercialOverride } from "@/lib/platformScopeFlags";

export type OriginCountyResolveInput = {
  countryCode?: string | null;
  stateCode?: string | null;
  countyCode?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export async function resolveCountySnapshotFromInput(
  supabase: SupabaseClient,
  input: OriginCountyResolveInput
): Promise<CountyServiceToggleSnapshot | null> {
  const country = String(input.countryCode ?? "US").trim().toUpperCase() || "US";
  if (!shouldApplyCountyCommercialOverride(country)) {
    // Outside US county gates: treat as a synthetic "on" county so origin rule
    // does not block non-US markets that still use country/region toggles.
    return {
      county_code: input.countyCode ?? "market",
      platform_enabled: true,
      taxi_enabled: true,
      delivery_enabled: true,
      restaurant_enabled: true,
      marketplace_enabled: true,
      checkout_enabled: true,
      maintenance_mode: false,
    };
  }

  let state =
    normalizeUsStateCode(input.stateCode) ??
    (Number.isFinite(Number(input.lat)) && Number.isFinite(Number(input.lng))
      ? detectUsStateFromCoordinates(input.lat, input.lng)
      : null);

  let county =
    normalizeUsCountyCode(input.countyCode) ??
    (Number.isFinite(Number(input.lat)) && Number.isFinite(Number(input.lng))
      ? detectUsCountyFromCoordinates(input.lat, input.lng, state)
      : null);

  if (!state && county) {
    // Known NY launch counties map to NY when state omitted.
    state = "NY";
  }

  if (!state || !county) {
    return null;
  }

  const regionCode = state.toLowerCase();
  const row = await fetchPlatformCountyConfig(supabase, country, regionCode, county);
  if (!row) {
    // County not seeded yet → treat as OFF (no hardcode allow).
    return {
      county_code: county,
      platform_enabled: false,
      taxi_enabled: false,
      delivery_enabled: false,
      restaurant_enabled: false,
      marketplace_enabled: false,
      checkout_enabled: false,
      maintenance_mode: false,
    };
  }

  // Apply state floor via full scope config.
  const scopeConfig = await fetchPlatformScopeConfig(supabase, {
    country_code: country,
    region_code: regionCode,
    mmd_zone_id: null,
    county_code: county,
  });

  if (!scopeConfig) {
    return toggleConfigToCountySnapshot({
      ...row,
      county_code: row.county_code,
    }, row.county_name);
  }

  return toggleConfigToCountySnapshot(
    {
      county_code: row.county_code,
      region_code: row.region_code,
      platform_enabled: scopeConfig.platform_enabled,
      taxi_enabled: scopeConfig.taxi_enabled,
      delivery_enabled: scopeConfig.delivery_enabled,
      restaurant_enabled: scopeConfig.restaurant_enabled,
      marketplace_enabled: scopeConfig.marketplace_enabled,
      seller_enabled: scopeConfig.seller_enabled,
      checkout_enabled: scopeConfig.checkout_enabled,
      maintenance_mode: scopeConfig.maintenance_mode,
    },
    row.county_name
  );
}

export async function assertCanStartServiceFromOrigin(
  supabase: SupabaseClient,
  params: {
    service: CountyServiceKind;
    origin: OriginCountyResolveInput;
    destination?: OriginCountyResolveInput | null;
  }
): Promise<CanStartServiceResult> {
  const originCounty = await resolveCountySnapshotFromInput(supabase, params.origin);
  const destinationCounty = params.destination
    ? await resolveCountySnapshotFromInput(supabase, params.destination)
    : null;

  return canStartServiceInCounty({
    service: params.service,
    originCounty,
    destinationCounty,
  });
}

export function enrichDriverFeaturesWithServiceArea(params: {
  features: {
    platform_enabled: boolean;
    can_go_online?: boolean;
    message: string | null;
    county_code?: string | null;
  };
  county: CountyServiceToggleSnapshot | null;
}): {
  can_go_online: boolean;
  can_receive_requests: boolean;
  out_of_service_area: boolean;
  driver_status_label: string | null;
  message: string | null;
  title: string | null;
} {
  const area = canDriverReceiveRequestsInCounty(
    countyOrFallback(params.county, params.features)
  );
  return {
    can_go_online: area.can_receive_requests && Boolean(params.features.platform_enabled),
    can_receive_requests: area.can_receive_requests,
    out_of_service_area: area.out_of_service_area,
    driver_status_label: area.status,
    message: area.out_of_service_area ? area.message : params.features.message,
    title: area.title,
  };
}

function countyOrFallback(
  county: CountyServiceToggleSnapshot | null,
  features: { platform_enabled: boolean; county_code?: string | null }
): CountyServiceToggleSnapshot | null {
  if (county) return county;
  if (!features.county_code) return null;
  return {
    county_code: features.county_code,
    platform_enabled: features.platform_enabled,
    taxi_enabled: features.platform_enabled,
    delivery_enabled: features.platform_enabled,
    restaurant_enabled: features.platform_enabled,
    marketplace_enabled: features.platform_enabled,
  };
}

export function scopeKeyToOriginInput(scope: PlatformScopeKey): OriginCountyResolveInput {
  return {
    countryCode: scope.country_code,
    stateCode: scope.state_code,
    countyCode: scope.county_code,
  };
}
