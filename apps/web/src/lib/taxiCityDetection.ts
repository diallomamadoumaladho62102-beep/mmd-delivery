import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeTaxiCountryCode } from "@/lib/taxiCountries";

export function normalizeTaxiCityName(city: unknown): string | null {
  const normalized = String(city ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

type MapboxPlaceFeature = {
  text?: string;
  place_name?: string;
  place_type?: string[];
  properties?: { short_code?: string };
};

/** Reverse-geocode pickup coordinates to a city/locality label. */
export async function detectTaxiCityFromCoords(
  lat: unknown,
  lng: unknown,
): Promise<string | null> {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) return null;

  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json` +
    `?types=place,locality,region,district&limit=5&access_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = (await res.json().catch(() => null)) as {
      features?: MapboxPlaceFeature[];
    } | null;

    if (!res.ok || !data?.features?.length) return null;

    const preferredTypes = ["place", "locality", "district", "region"];
    for (const type of preferredTypes) {
      const feature = data.features.find((row) => row.place_type?.includes(type));
      const label = feature?.text ?? feature?.place_name;
      const normalized = normalizeTaxiCityName(label);
      if (normalized) return normalized;
    }

    return normalizeTaxiCityName(data.features[0]?.text ?? data.features[0]?.place_name);
  } catch {
    return null;
  }
}

export async function resolveTaxiPickupCity(params: {
  supabaseAdmin: SupabaseClient;
  pickupLocationId?: string | null;
  pickupLat?: unknown;
  pickupLng?: unknown;
  pickupAddress?: string | null;
}): Promise<string | null> {
  const locationId = String(params.pickupLocationId ?? "").trim();
  if (locationId) {
    const { data: location } = await params.supabaseAdmin
      .from("location_points")
      .select("city_name,commune_name,prefecture_name,region_name")
      .eq("id", locationId)
      .maybeSingle();

    if (location) {
      for (const key of ["city_name", "commune_name", "prefecture_name", "region_name"] as const) {
        const normalized = normalizeTaxiCityName(location[key]);
        if (normalized) return normalized;
      }
    }
  }

  const fromCoords = await detectTaxiCityFromCoords(params.pickupLat, params.pickupLng);
  if (fromCoords) return fromCoords;

  const address = String(params.pickupAddress ?? "").trim();
  if (!address) return null;

  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return normalizeTaxiCityName(parts[parts.length - 2]);
  }

  return null;
}

export function resolveTaxiDispatchRuleScope(input: {
  countryCode?: unknown;
  pickupCity?: unknown;
}): { countryCode: string | null; pickupCity: string | null } {
  const countryRaw = String(input.countryCode ?? "").trim();
  const countryCode = countryRaw ? normalizeTaxiCountryCode(countryRaw) : null;
  return {
    countryCode,
    pickupCity: normalizeTaxiCityName(input.pickupCity),
  };
}
