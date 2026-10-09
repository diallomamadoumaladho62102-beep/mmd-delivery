import { resolveGuineaStandardVehicle } from "@/lib/markets/guineaStandard";

/**
 * Guinea is one national market.
 *
 * The server decides it from coordinates, then confirms the country with the
 * existing Mapbox reverse geocode. A client string cannot move a US trip onto
 * Guinea pricing, and a trip inside Guinea is never priced in USD.
 *
 * The envelope below is only a prefilter, the same box the mobile app already
 * uses to infer a possible GN point. It is not a border and not a city list.
 * A point inside it becomes a Guinea trip only after Mapbox reverse geocode
 * returns country GN for every point. A missing or different country is rejected.
 */

export const GUINEA_COUNTRY_CODE = "GN";
export const GUINEA_COUNTRY_NAME = "Guinea";
export const GUINEA_CURRENCY = "GNF";
export const GUINEA_TIMEZONE = "Africa/Conakry";

/**
 * Same bounds as apps/mobile/src/lib/marketScope.ts inferCountryFromCoordinates.
 * Not a legal border and not a list of cities.
 */
export const GUINEA_NATIONAL_EXTENT = {
  minLat: 7,
  maxLat: 13,
  minLng: -16,
  maxLng: -7,
} as const;

export type GuineaMarketDecision =
  | { kind: "us" }
  | { kind: "guinea"; vehicle: "car" | "motorcycle" }
  | { kind: "reject"; status: number; error: string };

export function isGuineaMarketEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = String(env.GUINEA_MARKET_ENABLED ?? "").trim().toLowerCase();
  if (!raw) return true;
  return raw === "true" || raw === "1" || raw === "on" || raw === "yes";
}

export function isValidTaxiCoordinate(lat: unknown, lng: unknown): boolean {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  if (Math.abs(latitude) < 0.000001 && Math.abs(longitude) < 0.000001) return false;
  return true;
}

export function coordinatesInGuineaNationalExtent(lat: number, lng: number): boolean {
  return (
    lat >= GUINEA_NATIONAL_EXTENT.minLat &&
    lat <= GUINEA_NATIONAL_EXTENT.maxLat &&
    lng >= GUINEA_NATIONAL_EXTENT.minLng &&
    lng <= GUINEA_NATIONAL_EXTENT.maxLng
  );
}

/**
 * Final country check. Every point must be a detected GN.
 * A missing geocoder answer is not Guinea, and a client claim is not evidence.
 */
export function guineaCountryEvidenceAllowsMarket(
  detectedCountryCodes: Array<string | null | undefined>,
): boolean {
  if (detectedCountryCodes.length === 0) return false;
  return detectedCountryCodes.every(
    (code) => String(code ?? "").trim().toUpperCase() === GUINEA_COUNTRY_CODE,
  );
}

/** First place name from a label. Coordinates are not a city. */
export function localityLabel(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(text)) return null;
  const first = text.split(",")[0]?.trim() ?? "";
  if (!first) return null;
  return first.slice(0, 80);
}

export function resolveGuineaTaxiMarket(input: {
  enabled: boolean;
  claimedCountryCode?: string | null;
  pickupLat: unknown;
  pickupLng: unknown;
  dropoffLat: unknown;
  dropoffLng: unknown;
  stops?: Array<{ lat?: unknown; lng?: unknown }> | null;
  sharedRide?: boolean;
  tripMode?: string | null;
  vehicleClass?: string | null;
}): GuineaMarketDecision {
  const pickupOk = isValidTaxiCoordinate(input.pickupLat, input.pickupLng);
  const dropoffOk = isValidTaxiCoordinate(input.dropoffLat, input.dropoffLng);
  if (!pickupOk || !dropoffOk) {
    return { kind: "reject", status: 400, error: "invalid_coordinates" };
  }

  const pickupIn = coordinatesInGuineaNationalExtent(
    Number(input.pickupLat),
    Number(input.pickupLng),
  );
  const dropoffIn = coordinatesInGuineaNationalExtent(
    Number(input.dropoffLat),
    Number(input.dropoffLng),
  );
  const claimed = String(input.claimedCountryCode ?? "").trim().toUpperCase();

  if (!pickupIn && !dropoffIn) {
    if (claimed === GUINEA_COUNTRY_CODE) {
      return { kind: "reject", status: 400, error: "market_mismatch" };
    }
    return { kind: "us" };
  }

  if (!pickupIn || !dropoffIn) {
    return { kind: "reject", status: 400, error: "outside_guinea" };
  }

  if (!input.enabled) {
    return { kind: "reject", status: 403, error: "guinea_market_disabled" };
  }

  for (const stop of input.stops ?? []) {
    if (!isValidTaxiCoordinate(stop.lat, stop.lng)) {
      return { kind: "reject", status: 400, error: "invalid_coordinates" };
    }
    if (!coordinatesInGuineaNationalExtent(Number(stop.lat), Number(stop.lng))) {
      return { kind: "reject", status: 400, error: "outside_guinea" };
    }
  }

  if ((input.stops?.length ?? 0) > 0) {
    return { kind: "reject", status: 400, error: "guinea_trip_not_supported" };
  }

  const tripMode = String(input.tripMode ?? "one_way").trim().toLowerCase();
  if (tripMode !== "one_way") {
    return { kind: "reject", status: 400, error: "guinea_trip_not_supported" };
  }

  const vehicle = resolveGuineaStandardVehicle(input.vehicleClass ?? "standard");
  if (vehicle.ok === false) {
    return { kind: "reject", status: 400, error: vehicle.error };
  }
  if (input.sharedRide === true && vehicle.vehicle === "motorcycle") {
    return { kind: "reject", status: 400, error: "guinea_motorcycle_pool_forbidden" };
  }

  return { kind: "guinea", vehicle: vehicle.vehicle };
}
