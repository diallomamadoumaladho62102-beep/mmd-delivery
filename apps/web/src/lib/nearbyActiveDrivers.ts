import { createHash } from "node:crypto";
import { isValidCoordinate } from "@/lib/taxiMapbox";

/** Pre-booking search is tighter than the 15-mile dispatch wave. */
export const NEARBY_MAX_RADIUS_MILES = 8;
export const NEARBY_DEFAULT_RADIUS_MILES = 5;
export const NEARBY_MIN_RADIUS_MILES = 0.25;
export const NEARBY_MAX_RESULTS = 8;
export const NEARBY_MAX_LOCATION_ROWS = 60;
export const NEARBY_MAX_ELIGIBILITY_CHECKS = 20;
export const NEARBY_FRESH_MS = 20 * 60 * 1000;
/** ~440 m grid. Returned points are cell centers, never the raw GPS fix. */
export const NEARBY_GRID_DEGREES = 0.004;
export const NEARBY_MAX_ETA_MINUTES = 180;

const MARKER_SALT = "mmd-nearby-marker-v1";

const PUBLIC_DRIVER_KEYS = ["marker_id", "latitude", "longitude"] as const;

export type NearbyCategory = "standard" | "comfort" | "xl" | "wheelchair_accessible";

export type NearbyLocationRow = {
  driver_id: string;
  lat: number;
  lng: number;
  updated_at: string;
};

export type NearbyProfileRow = {
  user_id: string;
  is_online: boolean;
  status: string;
  account_status: string;
  is_test?: boolean;
  archived?: boolean;
};

export type NearbyPublicDriver = {
  marker_id: string;
  latitude: number;
  longitude: number;
};

export type NearbyEta = {
  available: boolean;
  minutes: number | null;
};

export type NearbyPublicResponse = {
  ok: true;
  informational: true;
  category: NearbyCategory;
  radius_miles: number;
  drivers: NearbyPublicDriver[];
  eta: NearbyEta;
};

export function normalizeNearbyCategory(value: unknown): NearbyCategory | null {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw === "standard") return "standard";
  if (raw === "comfort" || raw === "premium") return "comfort";
  if (raw === "xl") return "xl";
  if (raw === "wheelchair_accessible" || raw === "wheelchair") return "wheelchair_accessible";
  return null;
}

export function clampNearbyRadiusMiles(value: unknown): number {
  if (value == null || value === "") return NEARBY_DEFAULT_RADIUS_MILES;
  const radius = Number(value);
  if (!Number.isFinite(radius)) return NEARBY_DEFAULT_RADIUS_MILES;
  return Math.min(NEARBY_MAX_RADIUS_MILES, Math.max(NEARBY_MIN_RADIUS_MILES, radius));
}

export function milesBetween(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function nearbyBoundingBox(
  lat: number,
  lng: number,
  radiusMiles: number,
): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const latDelta = radiusMiles / 69;
  const cos = Math.cos((lat * Math.PI) / 180);
  const lngDelta = radiusMiles / (69 * Math.max(Math.abs(cos), 0.2));
  return {
    minLat: Math.max(-90, lat - latDelta),
    maxLat: Math.min(90, lat + latDelta),
    minLng: Math.max(-180, lng - lngDelta),
    maxLng: Math.min(180, lng + lngDelta),
  };
}

export function isNearbyLocationFresh(updatedAt: string, now: Date): boolean {
  const timestamp = Date.parse(updatedAt);
  if (!Number.isFinite(timestamp)) return false;
  const age = now.getTime() - timestamp;
  return age >= -60_000 && age <= NEARBY_FRESH_MS;
}

export function anonymousMarkerId(driverId: string): string {
  return createHash("sha256")
    .update(`${MARKER_SALT}:${driverId}`)
    .digest("hex")
    .slice(0, 16);
}

function snapToGrid(value: number): number {
  const snapped = Math.round(value / NEARBY_GRID_DEGREES) * NEARBY_GRID_DEGREES;
  const shifted = Math.abs(snapped - value) < 1e-8 ? snapped + NEARBY_GRID_DEGREES / 2 : snapped;
  return Number(shifted.toFixed(5));
}

/** Grid cell, shifted off the raw fix when the fix already sits on a grid line. */
export function obfuscateDriverPoint(
  lat: number,
  lng: number,
): { latitude: number; longitude: number } {
  return {
    latitude: snapToGrid(lat),
    longitude: snapToGrid(lng),
  };
}

export function passesLocalNearbyRules(input: {
  profile: NearbyProfileRow | undefined;
  updatedAt: string;
  miles: number;
  radiusMiles: number;
  now: Date;
}): boolean {
  const profile = input.profile;
  if (!profile) return false;
  if (profile.is_online !== true) return false;
  if (String(profile.status ?? "").trim().toLowerCase() !== "approved") return false;
  if (String(profile.account_status ?? "").trim().toLowerCase() !== "active") return false;
  if (profile.is_test === true || profile.archived === true) return false;
  if (!isNearbyLocationFresh(input.updatedAt, input.now)) return false;
  if (!Number.isFinite(input.miles) || input.miles > input.radiusMiles) return false;
  return true;
}

export function toPublicNearbyDriver(
  driverId: string,
  lat: number,
  lng: number,
): NearbyPublicDriver {
  const point = obfuscateDriverPoint(lat, lng);
  const driver: NearbyPublicDriver = {
    marker_id: anonymousMarkerId(driverId),
    latitude: point.latitude,
    longitude: point.longitude,
  };
  const keys = Object.keys(driver);
  if (keys.length !== PUBLIC_DRIVER_KEYS.length || keys.some((key) => !PUBLIC_DRIVER_KEYS.includes(key as (typeof PUBLIC_DRIVER_KEYS)[number]))) {
    throw new Error("nearby_public_shape");
  }
  if (driver.marker_id === driverId || driver.marker_id.includes(driverId)) {
    throw new Error("nearby_marker_identity");
  }
  if (driver.latitude === lat || driver.longitude === lng) {
    throw new Error("nearby_exact_gps");
  }
  return driver;
}

export async function resolvePrebookingEta(
  nearest: { lat: number; lng: number } | null,
  pickup: { lat: number; lng: number },
  routeMinutes: (from: { lat: number; lng: number }, to: { lat: number; lng: number }) => Promise<number>,
): Promise<NearbyEta> {
  if (!nearest) return { available: false, minutes: null };
  try {
    const minutes = await routeMinutes(nearest, pickup);
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > NEARBY_MAX_ETA_MINUTES) {
      return { available: false, minutes: null };
    }
    return { available: true, minutes: Math.round(minutes) };
  } catch {
    return { available: false, minutes: null };
  }
}

export function validateNearbyPickup(
  lat: unknown,
  lng: unknown,
): { lat: number; lng: number } | null {
  if (!isValidCoordinate(lat, lng)) return null;
  return { lat: Number(lat), lng: Number(lng) };
}
