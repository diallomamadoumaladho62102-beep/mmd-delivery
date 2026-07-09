import type { SupabaseClient } from "@supabase/supabase-js";
import {
  detectPlatformCountryFromCoordinates,
  detectUsStateFromCoordinates,
  inferPlatformCountryCode,
  normalizePlatformCountryCode,
} from "@/lib/platformCountryInference";
import type {
  PlatformCountryConfig,
  PlatformFeature,
  PlatformFeatureResult,
  PlatformVertical,
} from "@/lib/platformLaunchControl";
import {
  assertPlatformFeature,
  assertPlatformFeatureFromConfig,
} from "@/lib/platformLaunchControl";
import {
  isPlatformUiFeaturesOnly,
  shouldApplyCountyCommercialOverride,
  shouldApplyRegionCommercialOverride,
} from "@/lib/platformScopeFlags";
import type {
  PlatformCountyRow,
  PlatformFeatureAvailability,
  PlatformRegionRow,
  PlatformScopeKey,
  PlatformScopeLevel,
  PlatformScopeSource,
  PlatformToggleConfig,
} from "@/lib/platformScopeTypes";
import { isAiAssistantEnabled } from "@/lib/ai/aiConfig";
import {
  isMarketplaceCheckoutLiveEnabledForConfig,
  isMarketplaceDispatchLiveEnabledForConfig,
  isMarketplacePayoutsLiveEnabledForConfig,
} from "@/lib/marketplaceLaunchControl";
import {
  detectUsCountyFromCoordinates,
  normalizeUsCountyCode,
} from "@/lib/platformCountyInference";

export type {
  PlatformFeatureAvailability,
  PlatformScopeKey,
  PlatformScopeSource,
} from "@/lib/platformScopeTypes";

const COUNTRY_SELECT =
  "id, country_code, country_name, continent, region, platform_enabled, taxi_enabled, delivery_enabled, restaurant_enabled, marketplace_enabled, seller_enabled, checkout_enabled, payout_enabled, marketplace_checkout_live_enabled, marketplace_dispatch_live_enabled, marketplace_payouts_live_enabled, maintenance_mode, launch_status, ai_enabled, ai_enabled_updated_at, ai_enabled_updated_by, created_at, updated_at";

const REGION_SELECT =
  "id, country_code, region_code, region_name, region_type, mmd_zone_id, platform_enabled, taxi_enabled, delivery_enabled, restaurant_enabled, marketplace_enabled, seller_enabled, checkout_enabled, payout_enabled, marketplace_checkout_live_enabled, marketplace_dispatch_live_enabled, marketplace_payouts_live_enabled, maintenance_mode, launch_status, ai_enabled, ai_enabled_updated_at, ai_enabled_updated_by";

const COUNTY_SELECT =
  "id, country_code, region_code, county_code, county_name, platform_enabled, taxi_enabled, delivery_enabled, restaurant_enabled, marketplace_enabled, seller_enabled, checkout_enabled, payout_enabled, maintenance_mode, launch_status";

const US_STATE_NAME_TO_CODE: Record<string, string> = {
  ALABAMA: "AL",
  ALASKA: "AK",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  FLORIDA: "FL",
  GEORGIA: "GA",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  "NEW HAMPSHIRE": "NH",
  "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM",
  "NEW YORK": "NY",
  "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PENNSYLVANIA: "PA",
  "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  "WEST VIRGINIA": "WV",
  WISCONSIN: "WI",
  WYOMING: "WY",
  "DISTRICT OF COLUMBIA": "DC",
};

export function normalizeUsStateCode(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;

  const normalizedName = upper.replace(/\./g, "").replace(/\s+/g, " ");
  return US_STATE_NAME_TO_CODE[normalizedName] ?? null;
}

export function countryConfigToToggleConfig(
  config: PlatformCountryConfig & {
    marketplace_enabled?: boolean;
    seller_enabled?: boolean;
  },
  scopeLevel: PlatformScopeLevel = "country"
): PlatformToggleConfig {
  return {
    country_code: config.country_code,
    region_code: null,
    county_code: null,
    scope_level: scopeLevel,
    platform_enabled: config.platform_enabled,
    taxi_enabled: config.taxi_enabled,
    delivery_enabled: config.delivery_enabled,
    restaurant_enabled: config.restaurant_enabled,
    marketplace_enabled: Boolean(config.marketplace_enabled),
    seller_enabled: Boolean(config.seller_enabled),
    checkout_enabled: config.checkout_enabled,
    payout_enabled: config.payout_enabled,
    marketplace_checkout_live_enabled: Boolean(config.marketplace_checkout_live_enabled),
    marketplace_dispatch_live_enabled: Boolean(config.marketplace_dispatch_live_enabled),
    marketplace_payouts_live_enabled: Boolean(config.marketplace_payouts_live_enabled),
    maintenance_mode: config.maintenance_mode,
    launch_status: config.launch_status,
    ai_enabled: Boolean((config as { ai_enabled?: boolean }).ai_enabled),
  };
}

export function regionRowToToggleConfig(row: PlatformRegionRow): PlatformToggleConfig {
  return {
    country_code: row.country_code,
    region_code: row.region_code,
    county_code: null,
    scope_level: row.mmd_zone_id ? "zone" : "region",
    platform_enabled: row.platform_enabled,
    taxi_enabled: row.taxi_enabled,
    delivery_enabled: row.delivery_enabled,
    restaurant_enabled: row.restaurant_enabled,
    marketplace_enabled: row.marketplace_enabled,
    seller_enabled: row.seller_enabled,
    checkout_enabled: row.checkout_enabled,
    payout_enabled: row.payout_enabled,
    marketplace_checkout_live_enabled: Boolean(row.marketplace_checkout_live_enabled),
    marketplace_dispatch_live_enabled: Boolean(row.marketplace_dispatch_live_enabled),
    marketplace_payouts_live_enabled: Boolean(row.marketplace_payouts_live_enabled),
    maintenance_mode: row.maintenance_mode,
    launch_status: row.launch_status,
    ai_enabled: Boolean(row.ai_enabled),
  };
}

export function countyRowToToggleConfig(row: PlatformCountyRow): PlatformToggleConfig {
  return {
    country_code: row.country_code,
    region_code: row.region_code,
    county_code: row.county_code,
    scope_level: "county",
    platform_enabled: row.platform_enabled,
    taxi_enabled: row.taxi_enabled,
    delivery_enabled: row.delivery_enabled,
    restaurant_enabled: row.restaurant_enabled,
    marketplace_enabled: row.marketplace_enabled,
    seller_enabled: row.seller_enabled,
    checkout_enabled: row.checkout_enabled,
    payout_enabled: row.payout_enabled,
    marketplace_checkout_live_enabled: false,
    marketplace_dispatch_live_enabled: false,
    marketplace_payouts_live_enabled: false,
    maintenance_mode: row.maintenance_mode,
    launch_status: row.launch_status,
    ai_enabled: false,
  };
}

export { normalizeUsCountyCode };

export async function fetchPlatformCountryConfigExtended(
  supabase: SupabaseClient,
  countryCode: string
): Promise<(PlatformCountryConfig & { marketplace_enabled: boolean; seller_enabled: boolean }) | null> {
  const code = normalizePlatformCountryCode(countryCode);
  if (!code) return null;

  const { data, error } = await supabase
    .from("platform_countries")
    .select(COUNTRY_SELECT)
    .eq("country_code", code)
    .maybeSingle();

  if (error || !data) return null;
  return data as PlatformCountryConfig & {
    marketplace_enabled: boolean;
    seller_enabled: boolean;
  };
}

export async function fetchPlatformRegionConfig(
  supabase: SupabaseClient,
  countryCode: string,
  regionCode: string
): Promise<PlatformRegionRow | null> {
  const country = normalizePlatformCountryCode(countryCode);
  const region = String(regionCode ?? "").trim().toLowerCase();
  if (!country || !region) return null;

  const { data, error } = await supabase
    .from("platform_regions")
    .select(REGION_SELECT)
    .eq("country_code", country)
    .eq("region_code", region)
    .maybeSingle();

  if (error || !data) return null;
  return data as PlatformRegionRow;
}

export async function fetchPlatformRegionByMmdZoneId(
  supabase: SupabaseClient,
  mmdZoneId: string
): Promise<PlatformRegionRow | null> {
  const id = String(mmdZoneId ?? "").trim();
  if (!id) return null;

  const { data, error } = await supabase
    .from("platform_regions")
    .select(REGION_SELECT)
    .eq("mmd_zone_id", id)
    .maybeSingle();

  if (error || !data) return null;
  return data as PlatformRegionRow;
}

export async function fetchPlatformCountyConfig(
  supabase: SupabaseClient,
  countryCode: string,
  regionCode: string,
  countyCode: string
): Promise<PlatformCountyRow | null> {
  const country = normalizePlatformCountryCode(countryCode);
  const region = String(regionCode ?? "").trim().toLowerCase();
  const county = normalizeUsCountyCode(countyCode) ?? String(countyCode ?? "").trim().toLowerCase();
  if (!country || !region || !county) return null;

  const { data, error } = await supabase
    .from("platform_counties")
    .select(COUNTY_SELECT)
    .eq("country_code", country)
    .eq("region_code", region)
    .eq("county_code", county)
    .maybeSingle();

  if (error || !data) return null;
  return data as PlatformCountyRow;
}

function disabledToggleConfig(base: PlatformToggleConfig): PlatformToggleConfig {
  return {
    ...base,
    platform_enabled: false,
    taxi_enabled: false,
    delivery_enabled: false,
    restaurant_enabled: false,
    marketplace_enabled: false,
    seller_enabled: false,
    checkout_enabled: false,
    payout_enabled: false,
    marketplace_checkout_live_enabled: false,
    marketplace_dispatch_live_enabled: false,
    marketplace_payouts_live_enabled: false,
    ai_enabled: false,
  };
}

export function applyCountryFloor(
  countryConfig: PlatformToggleConfig,
  regionConfig: PlatformToggleConfig | null,
  applyRegionOverride: boolean
): PlatformToggleConfig {
  if (!countryConfig.platform_enabled) {
    return disabledToggleConfig(countryConfig);
  }

  if (!regionConfig || !applyRegionOverride) {
    return countryConfig;
  }

  return {
    ...regionConfig,
    country_code: countryConfig.country_code,
  };
}

/**
 * Country floor → region/state floor → county override.
 * If state (region) is OFF, all counties/services under it are OFF.
 * If county is OFF, all services in that county are OFF.
 */
export function applyCountyFloor(
  countryConfig: PlatformToggleConfig,
  regionConfig: PlatformToggleConfig | null,
  countyConfig: PlatformToggleConfig | null,
  applyRegionOverride: boolean,
  applyCountyOverride: boolean
): PlatformToggleConfig {
  const afterRegion = applyCountryFloor(countryConfig, regionConfig, applyRegionOverride);

  if (!afterRegion.platform_enabled) {
    return disabledToggleConfig(afterRegion);
  }

  if (!countyConfig || !applyCountyOverride) {
    return afterRegion;
  }

  // State OFF already collapsed above; county cannot re-enable above state.
  if (regionConfig && applyRegionOverride && !regionConfig.platform_enabled) {
    return disabledToggleConfig({
      ...afterRegion,
      county_code: countyConfig.county_code,
      scope_level: "county",
    });
  }

  if (!countyConfig.platform_enabled) {
    return disabledToggleConfig({
      ...countyConfig,
      country_code: countryConfig.country_code,
      region_code: regionConfig?.region_code ?? countyConfig.region_code,
    });
  }

  return {
    ...countyConfig,
    country_code: countryConfig.country_code,
    region_code: regionConfig?.region_code ?? countyConfig.region_code,
    // County rows do not carry marketplace live flags — inherit from region/country floor.
    marketplace_checkout_live_enabled: afterRegion.marketplace_checkout_live_enabled,
    marketplace_dispatch_live_enabled: afterRegion.marketplace_dispatch_live_enabled,
    marketplace_payouts_live_enabled: afterRegion.marketplace_payouts_live_enabled,
    ai_enabled: afterRegion.ai_enabled,
  };
}

export async function fetchPlatformScopeConfig(
  supabase: SupabaseClient,
  scope: Pick<PlatformScopeKey, "country_code" | "region_code" | "mmd_zone_id"> & {
    county_code?: string | null;
  }
): Promise<PlatformToggleConfig | null> {
  const countryCode = normalizePlatformCountryCode(scope.country_code);
  if (!countryCode) return null;

  const countryRow = await fetchPlatformCountryConfigExtended(supabase, countryCode);
  if (!countryRow) return null;

  const countryConfig = countryConfigToToggleConfig(countryRow);
  const applyRegion = shouldApplyRegionCommercialOverride(countryCode);
  const applyCounty = shouldApplyCountyCommercialOverride(countryCode);

  let regionConfig: PlatformToggleConfig | null = null;
  let regionCodeForCounty: string | null = null;

  if (applyRegion) {
    if (scope.mmd_zone_id) {
      const byZone = await fetchPlatformRegionByMmdZoneId(supabase, scope.mmd_zone_id);
      if (byZone) {
        regionConfig = regionRowToToggleConfig(byZone);
        regionCodeForCounty = byZone.region_code;
      }
    }

    if (!regionConfig && scope.region_code) {
      const byRegion = await fetchPlatformRegionConfig(
        supabase,
        countryCode,
        scope.region_code
      );
      if (byRegion) {
        regionConfig = regionRowToToggleConfig(byRegion);
        regionCodeForCounty = byRegion.region_code;
      }
    }
  }

  let countyConfig: PlatformToggleConfig | null = null;
  if (applyCounty && scope.county_code && regionCodeForCounty) {
    const byCounty = await fetchPlatformCountyConfig(
      supabase,
      countryCode,
      regionCodeForCounty,
      scope.county_code
    );
    if (byCounty) countyConfig = countyRowToToggleConfig(byCounty);
  }

  return applyCountyFloor(
    countryConfig,
    regionConfig,
    countyConfig,
    applyRegion,
    applyCounty
  );
}

export function buildComingSoonServices(config: PlatformToggleConfig): string[] {
  const items: string[] = [];
  if (!config.marketplace_enabled) items.push("marketplace");
  if (!config.seller_enabled) items.push("seller");
  return items;
}

export function buildScopeMessage(
  config: PlatformToggleConfig,
  scope: PlatformScopeKey
): string | null {
  const maintenance =
    config.maintenance_mode || config.launch_status === "maintenance";

  if (maintenance) {
    return `MMD is under maintenance in ${scopeLabel(scope)}.`;
  }

  if (!config.platform_enabled) {
    return `MMD is not available yet in ${scopeLabel(scope)}.`;
  }

  return null;
}

function scopeLabel(scope: PlatformScopeKey): string {
  return buildScopeLabel(scope);
}

const GN_ZONE_LABELS: Record<string, string> = {
  gn_conakry: "Conakry",
  gn_labe: "Labé",
  gn_kankan: "Kankan",
  gn_kindia: "Kindia",
  gn_mamou: "Mamou",
  gn_boke: "Boké",
  gn_faranah: "Faranah",
  gn_nzerekore: "N'Zérékoré",
  gn_labe_mali_prefecture: "Mali",
  gn_labe_mali_dougountouny: "Dougountouny",
};

const US_COUNTY_LABELS: Record<string, string> = {
  nassau: "Nassau County",
  suffolk: "Suffolk County",
  nyc: "New York City",
  westchester: "Westchester County",
};

export function buildScopeLabel(
  scope: Pick<
    PlatformScopeKey,
    "country_code" | "state_code" | "region_code" | "zone_code" | "county_code"
  >
): string {
  if (scope.country_code === "US" && scope.state_code && scope.county_code) {
    const countyLabel =
      US_COUNTY_LABELS[scope.county_code] ?? scope.county_code.replace(/_/g, " ");
    return `US / ${scope.state_code} / ${countyLabel}`;
  }

  if (scope.country_code === "US" && scope.state_code) {
    return `US / ${scope.state_code}`;
  }

  if (scope.country_code === "GN" && scope.zone_code) {
    const zoneName = GN_ZONE_LABELS[scope.zone_code] ?? scope.zone_code;
    return `GN / ${zoneName}`;
  }

  if (scope.region_code) {
    return `${scope.country_code} / ${scope.region_code.toUpperCase()}`;
  }

  return scope.country_code;
}

export function buildScopeSourceLabel(source: PlatformScopeSource): string {
  switch (source) {
    case "order_pickup":
      return "order address";
    case "gps":
      return "GPS";
    case "manual":
      return "manual";
    case "saved_address":
      return "saved address";
    case "profile":
      return "profile";
    case "country_fallback":
      return "fallback";
    case "mission":
      return "mission";
    case "restaurant_address":
      return "restaurant address";
    case "seller_address":
      return "seller address";
    default:
      return source;
  }
}

export function buildFeatureAvailability(
  config: PlatformToggleConfig,
  scope: PlatformScopeKey
): PlatformFeatureAvailability {
  const maintenance =
    config.maintenance_mode || config.launch_status === "maintenance";
  const platformOn = config.platform_enabled && !maintenance;

  const message = buildScopeMessage(config, scope);

  return {
    country_code: scope.country_code,
    region_code: scope.region_code,
    state_code: scope.state_code,
    county_code: scope.county_code,
    mmd_zone_id: scope.mmd_zone_id,
    zone_code: scope.zone_code,
    scope_level: scope.scope_level,
    scope_source: scope.scope_source,
    scope_label: buildScopeLabel(scope),
    platform_enabled: config.platform_enabled,
    maintenance_mode: maintenance,
    taxi_available: platformOn && config.taxi_enabled,
    delivery_available: platformOn && config.delivery_enabled,
    restaurant_available: platformOn && config.restaurant_enabled,
    marketplace_available: platformOn && config.marketplace_enabled,
    seller_available: platformOn && config.seller_enabled,
    checkout_enabled: platformOn && config.checkout_enabled,
    payout_enabled: platformOn && config.payout_enabled,
    marketplace_checkout_live_enabled: isMarketplaceCheckoutLiveEnabledForConfig(config),
    marketplace_dispatch_live_enabled: isMarketplaceDispatchLiveEnabledForConfig(config),
    marketplace_payouts_live_enabled: isMarketplacePayoutsLiveEnabledForConfig(config),
    message,
    coming_soon_services: buildComingSoonServices(config),
    can_go_online: platformOn,
    can_accept_orders:
      platformOn && config.restaurant_enabled && config.checkout_enabled,
    ai_assistant_available: isAiAssistantEnabled() && platformOn && config.ai_enabled,
    refresh_after_ms: 300_000,
  };
}

export async function resolvePlatformScopeFeatures(
  supabase: SupabaseClient,
  scope: PlatformScopeKey
): Promise<PlatformFeatureAvailability | null> {
  const config = await fetchPlatformScopeConfig(supabase, scope);
  if (!config) return null;
  return buildFeatureAvailability(config, scope);
}

export async function resolveMarketplaceLiveFlagsForScope(
  supabase: SupabaseClient,
  scope: Pick<PlatformScopeKey, "country_code" | "region_code" | "mmd_zone_id"> & {
    county_code?: string | null;
  }
): Promise<{
  marketplace_checkout_live_enabled: boolean;
  marketplace_dispatch_live_enabled: boolean;
  marketplace_payouts_live_enabled: boolean;
}> {
  const config = await fetchPlatformScopeConfig(supabase, scope);
  if (!config) {
    return {
      marketplace_checkout_live_enabled: false,
      marketplace_dispatch_live_enabled: false,
      marketplace_payouts_live_enabled: false,
    };
  }

  return {
    marketplace_checkout_live_enabled: isMarketplaceCheckoutLiveEnabledForConfig(config),
    marketplace_dispatch_live_enabled: isMarketplaceDispatchLiveEnabledForConfig(config),
    marketplace_payouts_live_enabled: isMarketplacePayoutsLiveEnabledForConfig(config),
  };
}

export type ResolveClientScopeInput = {
  pickupCountry?: unknown;
  pickupState?: unknown;
  pickupCounty?: unknown;
  pickupLat?: unknown;
  pickupLng?: unknown;
  manualCountry?: unknown;
  manualState?: unknown;
  manualCounty?: unknown;
  manualRegionCode?: unknown;
  lat?: unknown;
  lng?: unknown;
};

export async function resolveClientPlatformScope(
  supabase: SupabaseClient,
  userId: string,
  input: ResolveClientScopeInput = {}
): Promise<PlatformScopeKey> {
  const pickupCountry = normalizePlatformCountryCode(input.pickupCountry);
  const pickupState = normalizeUsStateCode(input.pickupState);

  if (pickupCountry.length === 2) {
    return buildScopeKey({
      country: pickupCountry,
      state: pickupState,
      county: normalizeUsCountyCode(input.pickupCounty),
      source: "order_pickup",
    });
  }

  const pickupLat = Number(input.pickupLat);
  const pickupLng = Number(input.pickupLng);
  if (Number.isFinite(pickupLat) && Number.isFinite(pickupLng)) {
    return resolveScopeFromCoordinates(supabase, pickupLat, pickupLng, "order_pickup");
  }

  const lat = Number(input.lat);
  const lng = Number(input.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return resolveScopeFromCoordinates(supabase, lat, lng, "gps");
  }

  const manualCountry = normalizePlatformCountryCode(
    input.manualCountry ?? input.manualRegionCode
  );
  const manualState = normalizeUsStateCode(input.manualState);
  const manualCounty = normalizeUsCountyCode(input.manualCounty);
  if (manualCountry.length === 2) {
    const gnZone =
      manualCountry === "GN"
        ? await resolveGuineaZoneFromAddress(supabase, {
            region_name: null,
            prefecture_name: null,
            city_name: null,
          })
        : null;

    return buildScopeKey({
      country: manualCountry,
      state: manualState,
      county: manualCounty,
      regionCode: gnZone?.zone_code ?? null,
      mmdZoneId: gnZone?.id ?? null,
      zoneCode: gnZone?.zone_code ?? null,
      scopeLevel: gnZone
        ? "zone"
        : manualCounty
          ? "county"
          : manualState
            ? "region"
            : "country",
      source: "manual",
    });
  }

  const { data: address } = await supabase
    .from("client_addresses")
    .select("country, state")
    .eq("user_id", userId)
    .eq("is_default", true)
    .maybeSingle();

  const savedCountry = normalizePlatformCountryCode(address?.country);
  const savedState = normalizeUsStateCode(address?.state);

  if (savedCountry.length === 2) {
    const gnZone =
      savedCountry === "GN"
        ? await resolveGuineaZoneFromAddress(supabase, {
            region_name: null,
            prefecture_name: null,
            city_name: null,
          })
        : null;

    return buildScopeKey({
      country: savedCountry,
      state: savedState,
      regionCode: gnZone?.zone_code ?? null,
      mmdZoneId: gnZone?.id ?? null,
      zoneCode: gnZone?.zone_code ?? null,
      scopeLevel: gnZone ? "zone" : savedState ? "region" : "country",
      source: "saved_address",
    });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("country_code")
    .eq("id", userId)
    .maybeSingle();

  const profileCountry = normalizePlatformCountryCode(
    (profile as { country_code?: string } | null)?.country_code
  );

  if (profileCountry.length === 2) {
    const gnZone =
      profileCountry === "GN"
        ? await resolveGuineaZoneFromAddress(supabase, {
            region_name: null,
            prefecture_name: null,
            city_name: null,
          })
        : null;

    return buildScopeKey({
      country: profileCountry,
      regionCode: gnZone?.zone_code ?? null,
      mmdZoneId: gnZone?.id ?? null,
      zoneCode: gnZone?.zone_code ?? null,
      scopeLevel: gnZone ? "zone" : "country",
      source: "profile",
    });
  }

  return buildScopeKey({
    country: "US",
    source: "country_fallback",
  });
}

async function resolveScopeFromCoordinates(
  supabase: SupabaseClient,
  lat: number,
  lng: number,
  source: PlatformScopeSource
): Promise<PlatformScopeKey> {
  const country =
    detectPlatformCountryFromCoordinates(lat, lng) ??
    inferPlatformCountryCode({ lat, lng });

  let state: string | null = null;
  let county: string | null = null;
  if (country === "US") {
    state = detectUsStateFromCoordinates(lat, lng);
    county = detectUsCountyFromCoordinates(lat, lng, state);
  }

  const gnZone =
    country === "GN" ? await resolveGuineaZoneFromCoordinates(supabase, lat, lng) : null;

  return buildScopeKey({
    country,
    state,
    county,
    regionCode: gnZone?.zone_code ?? null,
    mmdZoneId: gnZone?.id ?? null,
    zoneCode: gnZone?.zone_code ?? null,
    scopeLevel: gnZone ? "zone" : county ? "county" : state ? "region" : "country",
    source,
  });
}

export type ResolveDriverScopeInput = {
  lat?: unknown;
  lng?: unknown;
  missionCountry?: unknown;
  missionRegionCode?: unknown;
  missionCountyCode?: unknown;
  missionMmdZoneId?: unknown;
};

export async function resolveDriverPlatformScope(
  supabase: SupabaseClient,
  userId: string,
  input: ResolveDriverScopeInput = {}
): Promise<PlatformScopeKey> {
  const lat = Number(input.lat);
  const lng = Number(input.lng);

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const country = inferPlatformCountryCode({ lat, lng });
    const state = country === "US" ? detectUsStateFromCoordinates(lat, lng) : null;
    const county =
      country === "US" ? detectUsCountyFromCoordinates(lat, lng, state) : null;
    const gnZone =
      country === "GN" ? await resolveGuineaZoneFromCoordinates(supabase, lat, lng) : null;

    return buildScopeKey({
      country,
      state,
      county,
      regionCode: gnZone?.zone_code ?? null,
      mmdZoneId: gnZone?.id ?? null,
      zoneCode: gnZone?.zone_code ?? null,
      scopeLevel: gnZone ? "zone" : county ? "county" : state ? "region" : "country",
      source: "gps",
    });
  }

  const missionCountry = normalizePlatformCountryCode(input.missionCountry);
  if (missionCountry.length === 2) {
    const missionCounty = normalizeUsCountyCode(input.missionCountyCode);
    return buildScopeKey({
      country: missionCountry,
      county: missionCounty,
      regionCode: String(input.missionRegionCode ?? "").trim().toLowerCase() || null,
      mmdZoneId: String(input.missionMmdZoneId ?? "").trim() || null,
      scopeLevel: input.missionMmdZoneId
        ? "zone"
        : missionCounty
          ? "county"
          : input.missionRegionCode
            ? "region"
            : "country",
      source: "mission",
    });
  }

  const { data: driverProfile } = await supabase
    .from("driver_profiles")
    .select("state")
    .eq("user_id", userId)
    .maybeSingle();

  const driverState = normalizeUsStateCode(
    (driverProfile as { state?: string } | null)?.state
  );

  if (driverState) {
    return buildScopeKey({
      country: "US",
      state: driverState,
      source: "profile",
    });
  }

  return buildScopeKey({
    country: "US",
    source: "country_fallback",
  });
}

export async function resolveRestaurantPlatformScope(
  supabase: SupabaseClient,
  restaurantUserId: string
): Promise<PlatformScopeKey> {
  const { data: profile } = await supabase
    .from("restaurant_profiles")
    .select("city, address, location_lat, location_lng")
    .eq("user_id", restaurantUserId)
    .maybeSingle();

  const city = String(profile?.city ?? "").trim().toUpperCase();
  const lat = Number(profile?.location_lat);
  const lng = Number(profile?.location_lng);

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const country = inferPlatformCountryCode({ lat, lng });
    if (country === "GN") {
      const gnZone = await resolveGuineaZoneFromCoordinates(supabase, lat, lng);
      if (gnZone) {
        return buildScopeKey({
          country: "GN",
          regionCode: gnZone.zone_code,
          mmdZoneId: gnZone.id,
          zoneCode: gnZone.zone_code,
          scopeLevel: "zone",
          source: "restaurant_address",
        });
      }
    }

    if (country === "US") {
      const state = detectUsStateFromCoordinates(lat, lng);
      const county = detectUsCountyFromCoordinates(lat, lng, state);
      return buildScopeKey({
        country,
        state,
        county,
        scopeLevel: county ? "county" : state ? "region" : "country",
        source: "restaurant_address",
      });
    }

    return buildScopeKey({
      country,
      source: "restaurant_address",
    });
  }

  if (city.includes("CONAKRY") || city.includes("GUINE")) {
    const gnZone = await resolveGuineaCommercialZoneByCode(supabase, "gn_conakry");
    return buildScopeKey({
      country: "GN",
      regionCode: gnZone?.zone_code ?? "gn_conakry",
      mmdZoneId: gnZone?.id ?? null,
      zoneCode: gnZone?.zone_code ?? "gn_conakry",
      scopeLevel: gnZone ? "zone" : "region",
      source: "restaurant_address",
    });
  }
  if (city.includes("DAKAR") || city.includes("SENEGAL")) {
    return buildScopeKey({ country: "SN", source: "restaurant_address" });
  }
  if (city.includes("ABIDJAN") || city.includes("IVOIRE")) {
    return buildScopeKey({ country: "CI", source: "restaurant_address" });
  }
  if (city.includes("BAMAKO") || city.includes("MALI")) {
    return buildScopeKey({ country: "ML", source: "restaurant_address" });
  }
  if (city.includes("FREETOWN") || city.includes("SIERRA")) {
    return buildScopeKey({ country: "SL", source: "restaurant_address" });
  }
  if (city.includes("NOUAKCHOTT") || city.includes("MAURITAN")) {
    return buildScopeKey({ country: "MR", source: "restaurant_address" });
  }

  return buildScopeKey({ country: "US", source: "country_fallback" });
}

function buildScopeKey(params: {
  country: string;
  state?: string | null;
  county?: string | null;
  regionCode?: string | null;
  mmdZoneId?: string | null;
  zoneCode?: string | null;
  scopeLevel?: PlatformScopeLevel;
  source: PlatformScopeSource;
}): PlatformScopeKey {
  const country_code = normalizePlatformCountryCode(params.country) || "US";
  const state_code = params.state ?? null;
  const county_code = params.county ?? null;
  const region_code =
    params.regionCode ??
    (state_code && country_code === "US" ? state_code.toLowerCase() : null);
  const scope_level =
    params.scopeLevel ??
    (params.mmdZoneId
      ? "zone"
      : county_code
        ? "county"
        : region_code
          ? "region"
          : "country");

  return {
    country_code,
    region_code,
    state_code,
    county_code,
    mmd_zone_id: params.mmdZoneId ?? null,
    zone_code: params.zoneCode ?? params.regionCode ?? null,
    scope_level,
    scope_source: params.source,
  };
}

type MmdZoneMatch = {
  id: string;
  zone_code: string;
  region_name: string | null;
  prefecture_name: string | null;
  city_name: string | null;
  commune_name: string | null;
  quartier_name: string | null;
};

const GN_COMMERCIAL_ZONE_CODES = [
  "gn_conakry",
  "gn_labe",
  "gn_kankan",
  "gn_kindia",
  "gn_mamou",
  "gn_boke",
  "gn_faranah",
  "gn_nzerekore",
  "gn_labe_mali_prefecture",
  "gn_labe_mali_dougountouny",
] as const;

async function resolveGuineaCommercialZoneByCode(
  supabase: SupabaseClient,
  zoneCode: string
): Promise<MmdZoneMatch | null> {
  const { data, error } = await supabase
    .from("mmd_zones")
    .select(
      "id, zone_code, region_name, prefecture_name, city_name, commune_name, quartier_name"
    )
    .eq("zone_code", zoneCode)
    .maybeSingle();

  if (error || !data) return null;
  return data as MmdZoneMatch;
}

async function resolveGuineaZoneFromAddress(
  supabase: SupabaseClient,
  fields: {
    region_name: string | null;
    prefecture_name: string | null;
    city_name: string | null;
  }
): Promise<MmdZoneMatch | null> {
  for (const zoneCode of GN_COMMERCIAL_ZONE_CODES) {
    const zone = await resolveGuineaCommercialZoneByCode(supabase, zoneCode);
    if (!zone) continue;
    if (
      fields.region_name &&
      zone.region_name &&
      !zone.region_name.toLowerCase().includes(fields.region_name.toLowerCase())
    ) {
      continue;
    }
    return zone;
  }
  return resolveGuineaCommercialZoneByCode(supabase, "gn_conakry");
}

async function resolveGuineaZoneFromCoordinates(
  supabase: SupabaseClient,
  lat: number,
  lng: number
): Promise<MmdZoneMatch | null> {
  void lat;
  void lng;
  return resolveGuineaCommercialZoneByCode(supabase, "gn_conakry");
}

export async function assertPlatformScopeFeature(
  supabase: SupabaseClient,
  scope: Pick<PlatformScopeKey, "country_code" | "region_code" | "mmd_zone_id"> & {
    county_code?: string | null;
  },
  vertical: PlatformVertical,
  feature: PlatformFeature
): Promise<PlatformFeatureResult & { region_code?: string; county_code?: string; scope_level?: string }> {
  const config = await fetchPlatformScopeConfig(supabase, scope);
  if (!config) {
    const code = normalizePlatformCountryCode(scope.country_code);
    return {
      ok: false,
      error: "platform_country_not_configured",
      message: `Platform country ${code} is not configured`,
      country_code: code,
    };
  }

  const legacyConfig: PlatformCountryConfig = {
    id: "scope",
    country_code: config.country_code,
    country_name: config.country_code,
    continent: null,
    region: config.region_code,
    platform_enabled: config.platform_enabled,
    taxi_enabled: config.taxi_enabled,
    delivery_enabled: config.delivery_enabled,
    restaurant_enabled: config.restaurant_enabled,
    marketplace_enabled: config.marketplace_enabled,
    seller_enabled: config.seller_enabled,
    checkout_enabled: config.checkout_enabled,
    payout_enabled: config.payout_enabled,
    marketplace_checkout_live_enabled: config.marketplace_checkout_live_enabled,
    marketplace_dispatch_live_enabled: config.marketplace_dispatch_live_enabled,
    marketplace_payouts_live_enabled: config.marketplace_payouts_live_enabled,
    maintenance_mode: config.maintenance_mode,
    launch_status: config.launch_status,
    created_at: "",
    updated_at: "",
  };

  const result = assertPlatformFeatureFromConfig(legacyConfig, vertical, feature);
  return {
    ...result,
    region_code: config.region_code ?? undefined,
    county_code: config.county_code ?? undefined,
    scope_level: config.scope_level,
  };
}

export async function assertPlatformFeatureWithScope(
  supabase: SupabaseClient,
  countryCode: string,
  vertical: PlatformVertical,
  feature: PlatformFeature,
  scope?: Pick<PlatformScopeKey, "region_code" | "mmd_zone_id" | "county_code"> | null
): Promise<PlatformFeatureResult> {
  const code = normalizePlatformCountryCode(countryCode);

  if (isPlatformUiFeaturesOnly() || !shouldApplyRegionCommercialOverride(code)) {
    return assertPlatformFeature(supabase, code, vertical, feature);
  }

  if (scope?.region_code || scope?.mmd_zone_id || scope?.county_code) {
    return assertPlatformScopeFeature(
      supabase,
      {
        country_code: code,
        region_code: scope.region_code ?? null,
        mmd_zone_id: scope.mmd_zone_id ?? null,
        county_code: scope.county_code ?? null,
      },
      vertical,
      feature
    );
  }

  return assertPlatformFeature(supabase, code, vertical, feature);
}

export async function resolvePlatformScope(
  supabase: SupabaseClient,
  actor: "client" | "driver" | "restaurant",
  userId: string,
  input: ResolveClientScopeInput & ResolveDriverScopeInput = {}
): Promise<PlatformScopeKey> {
  if (actor === "client") return resolveClientPlatformScope(supabase, userId, input);
  if (actor === "driver") return resolveDriverPlatformScope(supabase, userId, input);
  return resolveRestaurantPlatformScope(supabase, userId);
}
