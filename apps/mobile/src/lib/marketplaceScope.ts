import * as Location from "expo-location";
import { fetchClientPlatformFeatures } from "./platformFeaturesApi";
import { supabase } from "./supabase";

const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

export type MarketplaceScopeInput = {
  manualCountryCode?: string | null;
  locationCountryCode?: string | null;
  sellerCountryCode?: string | null;
};

let manualCountryCode: string | null = null;
let locationCountryCode: string | null = null;

export function normalizeMarketplaceCountryCode(value: unknown): string | null {
  const code = String(value ?? "")
    .trim()
    .toUpperCase();
  return COUNTRY_CODE_PATTERN.test(code) ? code : null;
}

/** Explicit user/marketplace session country override (highest priority). */
export function setMarketplaceManualCountryCode(code: string | null) {
  manualCountryCode = normalizeMarketplaceCountryCode(code);
}

/** Country from the most recently chosen MMD location (dropoff/pickup). */
export function setMarketplaceLocationCountryCode(code: string | null) {
  locationCountryCode = normalizeMarketplaceCountryCode(code);
}

async function readUserProfileCountry(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return null;

  const { data } = await supabase
    .from("client_addresses")
    .select("country")
    .eq("user_id", user.id)
    .eq("is_default", true)
    .maybeSingle();

  return normalizeMarketplaceCountryCode(data?.country);
}

async function readGpsCoords(): Promise<{ lat: number; lng: number } | null> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) return null;
    const position = await Location.getLastKnownPositionAsync();
    if (!position?.coords) return null;
    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    };
  } catch {
    return null;
  }
}

async function readPlatformFeaturesCountry(input?: {
  lat?: number;
  lng?: number;
  pickupCountry?: string;
}): Promise<string | null> {
  const features = await fetchClientPlatformFeatures({
    lat: input?.lat,
    lng: input?.lng,
    pickupCountry: input?.pickupCountry,
  });
  if (!features.ok) return null;
  return normalizeMarketplaceCountryCode(
    features.country_code ?? features.scope?.country_code
  );
}

/**
 * Resolve marketplace country for API scope (pickup_country).
 * Priority: manual → location → seller → GPS platform scope → platform scope → saved address.
 */
export async function resolveMarketplaceCountryCode(
  input: MarketplaceScopeInput = {}
): Promise<string | null> {
  const manual = normalizeMarketplaceCountryCode(
    input.manualCountryCode ?? manualCountryCode
  );
  if (manual) return manual;

  const fromLocation = normalizeMarketplaceCountryCode(
    input.locationCountryCode ?? locationCountryCode
  );
  if (fromLocation) return fromLocation;

  const seller = normalizeMarketplaceCountryCode(input.sellerCountryCode);
  if (seller) return seller;

  const gps = await readGpsCoords();
  if (gps) {
    const fromGps = await readPlatformFeaturesCountry(gps);
    if (fromGps) return fromGps;
  }

  const platform = await readPlatformFeaturesCountry();
  if (platform) return platform;

  const profile = await readUserProfileCountry();
  if (profile) return profile;

  return null;
}

export async function appendMarketplaceScopeQuery(
  searchParams: URLSearchParams,
  input: MarketplaceScopeInput = {}
): Promise<void> {
  const country = await resolveMarketplaceCountryCode(input);
  if (country) {
    searchParams.set("pickup_country", country);
  }
}
