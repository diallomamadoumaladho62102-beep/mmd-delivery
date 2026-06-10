import { getApiBaseUrl } from "../../lib/apiBase";
import { supabase } from "./supabase";

export type PlatformScopeLevel = "country" | "region" | "zone";

export type PlatformFeaturesResponse = {
  ok: boolean;
  error?: string;
  country_code?: string;
  region_code?: string | null;
  state_code?: string | null;
  mmd_zone_id?: string | null;
  zone_code?: string | null;
  scope_level?: PlatformScopeLevel;
  scope_source?: string;
  platform_enabled?: boolean;
  maintenance_mode?: boolean;
  taxi_available?: boolean;
  delivery_available?: boolean;
  restaurant_available?: boolean;
  marketplace_available?: boolean;
  seller_available?: boolean;
  checkout_enabled?: boolean;
  payout_enabled?: boolean;
  message?: string | null;
  coming_soon_services?: string[];
  can_go_online?: boolean;
  can_accept_orders?: boolean;
  refresh_after_ms?: number;
  scope?: {
    country_code: string;
    region_code: string | null;
    state_code: string | null;
    mmd_zone_id: string | null;
    zone_code: string | null;
    scope_level: PlatformScopeLevel;
    scope_source: string;
  };
};

async function getAccessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchClientPlatformFeatures(input?: {
  lat?: number;
  lng?: number;
  pickupCountry?: string;
  pickupState?: string;
  manualCountry?: string;
  manualState?: string;
}): Promise<PlatformFeaturesResponse> {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "not_authenticated" };

  const query = buildQuery({
    lat: input?.lat,
    lng: input?.lng,
    pickup_country: input?.pickupCountry,
    pickup_state: input?.pickupState,
    country: input?.manualCountry,
    state: input?.manualState,
  });

  const res = await fetch(`${getApiBaseUrl()}/api/platform/client-features${query}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  return (await res.json().catch(() => ({ ok: false, error: "invalid_json" }))) as PlatformFeaturesResponse;
}

export async function fetchDriverPlatformFeatures(input?: {
  lat?: number;
  lng?: number;
  missionCountry?: string;
  missionRegionCode?: string;
}): Promise<PlatformFeaturesResponse> {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "not_authenticated" };

  const query = buildQuery({
    lat: input?.lat,
    lng: input?.lng,
    mission_country: input?.missionCountry,
    mission_region_code: input?.missionRegionCode,
  });

  const res = await fetch(`${getApiBaseUrl()}/api/platform/driver-features${query}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  return (await res.json().catch(() => ({ ok: false, error: "invalid_json" }))) as PlatformFeaturesResponse;
}

export async function fetchRestaurantPlatformFeatures(): Promise<PlatformFeaturesResponse> {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "not_authenticated" };

  const res = await fetch(`${getApiBaseUrl()}/api/platform/restaurant-features`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  return (await res.json().catch(() => ({ ok: false, error: "invalid_json" }))) as PlatformFeaturesResponse;
}

export function defaultPlatformFeatures(): PlatformFeaturesResponse {
  return {
    ok: true,
    platform_enabled: true,
    maintenance_mode: false,
    taxi_available: true,
    delivery_available: true,
    restaurant_available: true,
    marketplace_available: false,
    seller_available: false,
    checkout_enabled: true,
    payout_enabled: true,
    can_go_online: true,
    can_accept_orders: true,
    coming_soon_services: ["marketplace", "seller"],
    message: null,
    refresh_after_ms: 300_000,
  };
}
