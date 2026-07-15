import { AFRICA_PLATFORM_COUNTRIES } from "@/lib/platformCountryInference";
import { getServerMapboxToken } from "@/lib/mapboxToken";

export type GeoPoint = { lat: number; lng: number };

export type GeoEvidence = {
  countryCode: string | null;
  region: string | null;
  label: string | null;
  placeTypes: string[];
  center: GeoPoint | null;
};

export type LocationClaim = GeoPoint & {
  address?: string | null;
  claimedCountryCode?: string | null;
  claimedRegion?: string | null;
  accuracyMeters?: number | null;
  role: "pickup" | "dropoff" | "stop";
};

export type LocationClaimResult =
  | {
      ok: true;
      canonicalAddress: string | null;
      countryCode: string | null;
      region: string | null;
      warnings: string[];
    }
  | { ok: false; code: string; message: string };

const MAX_PAID_ROUTE_MILES = 50;
const METERS_PER_MILE = 1609.344;
const cache = new Map<string, { expiresAt: number; value: GeoEvidence | null }>();

export function isValidGeoPoint(point: GeoPoint): boolean {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lng >= -180 &&
    point.lng <= 180 &&
    !(Math.abs(point.lat) < 0.000001 && Math.abs(point.lng) < 0.000001)
  );
}

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const radians = (value: number) => (value * Math.PI) / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const STOP_WORDS = new Set([
  "the", "and", "near", "road", "street", "avenue", "route",
  "rue", "près", "pres", "chez", "quartier", "secteur", "immeuble",
]);

export function addressTokens(value: unknown): string[] {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token))
    .filter((token) => !STOP_WORDS.has(token));
}

function hasSharedAddressToken(a: unknown, b: unknown): boolean {
  const left = new Set(addressTokens(a));
  return addressTokens(b).some((token) => left.has(token));
}

function normalizeCountry(value: unknown): string | null {
  const code = String(value ?? "").trim().toUpperCase().slice(0, 2);
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function isTolerantPlace(address: unknown, evidence: GeoEvidence): boolean {
  const text = String(address ?? "").toLowerCase();
  return (
    evidence.placeTypes.some((type) => ["poi", "place", "locality"].includes(type)) ||
    /\b(airport|aeroport|aéroport|parking|terminal|gare|market|marche|marché|mosquee|mosquée|hotel|hôtel|mall)\b/i.test(
      text,
    )
  );
}

export function evaluateLocationClaim(
  claim: LocationClaim,
  reverse: GeoEvidence | null,
  forward?: GeoEvidence | null,
): LocationClaimResult {
  if (!isValidGeoPoint(claim)) {
    return { ok: false, code: "invalid_coordinates", message: `${claim.role} coordinates are invalid` };
  }
  if (!reverse) {
    return {
      ok: false,
      code: "geographic_validation_unavailable",
      message: `Unable to validate ${claim.role} coordinates`,
    };
  }

  const warnings: string[] = [];
  const claimedCountry = normalizeCountry(claim.claimedCountryCode);
  const detectedCountry = normalizeCountry(reverse.countryCode);
  if (claimedCountry && detectedCountry && claimedCountry !== detectedCountry) {
    return {
      ok: false,
      code: "country_mismatch",
      message: `${claim.role} coordinates do not match the selected country`,
    };
  }

  const country = detectedCountry ?? claimedCountry;
  const isAfrica = Boolean(country && AFRICA_PLATFORM_COUNTRIES.has(country));
  const accuracy = Number(claim.accuracyMeters);
  if (Number.isFinite(accuracy) && accuracy > 150) warnings.push("low_gps_accuracy");

  const claimedRegion = String(claim.claimedRegion ?? "").trim().toLowerCase();
  const detectedRegion = String(reverse.region ?? "").trim().toLowerCase();
  if (claimedRegion && detectedRegion && claimedRegion !== detectedRegion) {
    if (country === "US") {
      return {
        ok: false,
        code: "region_mismatch",
        message: `${claim.role} coordinates do not match the selected region`,
      };
    }
    warnings.push("region_label_mismatch");
  }

  const address = String(claim.address ?? "").trim();
  if (address && forward?.center) {
    const distance = haversineMeters(claim, forward.center);
    const tolerant = isTolerantPlace(address, reverse) || isTolerantPlace(address, forward);
    const maxDistance = tolerant ? (isAfrica ? 8000 : 4000) : isAfrica ? 5000 : 2500;
    // The forward result naturally echoes the query, so only independent
    // reverse-geocode evidence may establish textual consistency.
    const labelsAgree = hasSharedAddressToken(address, reverse.label);
    if (distance > maxDistance && !labelsAgree) {
      return {
        ok: false,
        code: "address_coordinate_mismatch",
        message: `${claim.role} address and coordinates are inconsistent`,
      };
    }
    if (distance > maxDistance) warnings.push("address_coordinate_low_confidence");
  }

  // Street numbers are deliberately never required. This supports African
  // landmark directions, parking lots, airports and incomplete addressing.
  return {
    ok: true,
    canonicalAddress: reverse.label ?? (address || null),
    countryCode: country,
    region: reverse.region,
    warnings,
  };
}

export function evaluateServerRoute(input: {
  pickup: GeoPoint;
  dropoff: GeoPoint;
  serverDistanceMiles: number;
  clientDistanceMiles?: number | null;
  maxMiles?: number;
}): { ok: true; warnings: string[] } | { ok: false; code: string } {
  if (!isValidGeoPoint(input.pickup) || !isValidGeoPoint(input.dropoff)) {
    return { ok: false, code: "invalid_coordinates" };
  }
  const distance = Number(input.serverDistanceMiles);
  if (!Number.isFinite(distance) || distance <= 0) {
    return { ok: false, code: "route_unavailable" };
  }
  if (distance > (input.maxMiles ?? MAX_PAID_ROUTE_MILES)) {
    return { ok: false, code: "distance_too_far" };
  }

  const straightMiles = haversineMeters(input.pickup, input.dropoff) / METERS_PER_MILE;
  if (distance + 0.1 < straightMiles * 0.85) {
    return { ok: false, code: "server_route_impossible" };
  }

  const clientDistance = Number(input.clientDistanceMiles);
  if (Number.isFinite(clientDistance)) {
    const tolerance = Math.max(0.25, distance * 0.08);
    if (Math.abs(clientDistance - distance) > tolerance) {
      return { ok: false, code: "client_distance_mismatch" };
    }
  }

  const warnings = distance > straightMiles * 12 ? ["abnormal_route_ratio"] : [];
  return { ok: true, warnings };
}

type MapboxFeature = {
  center?: [number, number];
  place_name?: string;
  text?: string;
  place_type?: string[];
  properties?: { short_code?: string };
  context?: Array<{
    id?: string;
    text?: string;
    short_code?: string;
  }>;
};

function featureEvidence(feature: MapboxFeature | undefined): GeoEvidence | null {
  if (!feature) return null;
  const contexts = [feature, ...(feature.context ?? [])];
  const country = contexts.find((entry) => String((entry as { id?: string }).id ?? "").startsWith("country."));
  const region = contexts.find((entry) => String((entry as { id?: string }).id ?? "").startsWith("region."));
  const shortCode =
    (country as { properties?: { short_code?: string }; short_code?: string } | undefined)
      ?.properties?.short_code ??
    (country as { short_code?: string } | undefined)?.short_code ??
    feature.properties?.short_code;
  const center =
    Array.isArray(feature.center) && feature.center.length === 2
      ? { lng: Number(feature.center[0]), lat: Number(feature.center[1]) }
      : null;
  return {
    countryCode: normalizeCountry(shortCode),
    region: String(region?.text ?? "").trim() || null,
    label: String(feature.place_name ?? feature.text ?? "").trim() || null,
    placeTypes: Array.isArray(feature.place_type) ? feature.place_type : [],
    center: center && isValidGeoPoint(center) ? center : null,
  };
}

async function mapboxEvidence(url: string, cacheKey: string): Promise<GeoEvidence | null> {
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`geographic_validation_unavailable:${response.status}`);
  const body = (await response.json().catch(() => null)) as { features?: MapboxFeature[] } | null;
  const value = featureEvidence(body?.features?.[0]);
  cache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, value });
  return value;
}

export async function reverseGeocodeEvidence(point: GeoPoint): Promise<GeoEvidence | null> {
  if (!isValidGeoPoint(point)) return null;
  const token = getServerMapboxToken();
  const key = `r:${point.lat.toFixed(4)}:${point.lng.toFixed(4)}`;
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${point.lng},${point.lat}.json` +
    `?types=address,poi,place,locality,neighborhood&limit=1&access_token=${encodeURIComponent(token)}`;
  return mapboxEvidence(url, key);
}

export async function forwardGeocodeEvidence(
  address: string,
  countryCode?: string | null,
): Promise<GeoEvidence | null> {
  const query = String(address ?? "").trim();
  if (!query) return null;
  const token = getServerMapboxToken();
  const country = normalizeCountry(countryCode)?.toLowerCase();
  const key = `f:${country ?? ""}:${query.toLowerCase()}`;
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?types=address,poi,place,locality,neighborhood&limit=1` +
    `${country ? `&country=${country}` : ""}` +
    `&access_token=${encodeURIComponent(token)}`;
  return mapboxEvidence(url, key);
}

export async function validateLocationClaimServer(
  claim: LocationClaim,
): Promise<Extract<LocationClaimResult, { ok: true }>> {
  const reverse = await reverseGeocodeEvidence(claim);
  const forward = claim.address
    ? await forwardGeocodeEvidence(claim.address, claim.claimedCountryCode)
    : null;
  const result = evaluateLocationClaim(claim, reverse, forward);
  if (result.ok === false) throw new Error(result.code);
  return result;
}

export async function validateRouteClaimsServer(input: {
  pickup: Omit<LocationClaim, "role">;
  dropoff: Omit<LocationClaim, "role">;
  stops?: Array<Omit<LocationClaim, "role">>;
  serverDistanceMiles: number;
  clientDistanceMiles?: number | null;
  maxMiles?: number;
}): Promise<{
  pickup: Extract<LocationClaimResult, { ok: true }>;
  dropoff: Extract<LocationClaimResult, { ok: true }>;
  stops: Array<Extract<LocationClaimResult, { ok: true }>>;
}> {
  const claims: LocationClaim[] = [
    { ...input.pickup, role: "pickup" },
    { ...input.dropoff, role: "dropoff" },
    ...(input.stops ?? []).map((stop) => ({ ...stop, role: "stop" as const })),
  ];
  const results = await Promise.all(claims.map(validateLocationClaimServer));
  const countries = new Set(
    results
      .map((result) => result.countryCode)
      .filter((code): code is string => Boolean(code)),
  );
  if (countries.size > 1) throw new Error("cross_country_route_not_supported");

  const route = evaluateServerRoute({
    pickup: input.pickup,
    dropoff: input.dropoff,
    serverDistanceMiles: input.serverDistanceMiles,
    clientDistanceMiles: input.clientDistanceMiles,
    maxMiles: input.maxMiles,
  });
  if (route.ok === false) throw new Error(route.code);

  return {
    pickup: results[0],
    dropoff: results[1],
    stops: results.slice(2),
  };
}
