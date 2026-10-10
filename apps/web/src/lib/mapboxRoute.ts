import { metersToMiles } from "@/lib/deliveryPricing";
import { getServerMapboxToken } from "@/lib/mapboxToken";

const MAPBOX_DIRECTIONS_URL =
  "https://api.mapbox.com/directions/v5/mapbox/driving";

type LatLng = {
  lat: number;
  lng: number;
};

async function drivingRoute(origin: LatLng, destination: LatLng): Promise<{ distanceMeters: number; durationSeconds: number }> {
  let accessToken: string;
  try {
    accessToken = getServerMapboxToken();
  } catch {
    throw new Error("MAPBOX_ACCESS_TOKEN missing");
  }
  const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = `${MAPBOX_DIRECTIONS_URL}/${coords}?alternatives=false&geometries=geojson&overview=simplified&access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox Directions unavailable (${res.status})`);
  const json = (await res.json().catch(() => null)) as {
    routes?: Array<{ distance?: number; duration?: number }>;
  } | null;
  const route = json?.routes?.[0];
  if (!route || !Number.isFinite(route.distance) || !Number.isFinite(route.duration)) {
    throw new Error("Mapbox Directions returned no usable route");
  }
  return { distanceMeters: Number(route.distance), durationSeconds: Number(route.duration) };
}

/** Road distance and driving time. Fails closed. Does not estimate a straight line. */
export async function getDrivingLeg(origin: LatLng, destination: LatLng): Promise<{ distanceMeters: number; etaMinutes: number }> {
  const route = await drivingRoute(origin, destination);
  return { distanceMeters: route.distanceMeters, etaMinutes: Math.round(route.durationSeconds / 60) };
}

/**
 * Server-only Mapbox Directions for paid food/errand quotes.
 * Uses MAPBOX_ACCESS_TOKEN only — never the public client token.
 * Fail-closed: throws when token missing or Directions fails (no Haversine).
 */
export async function getDistanceAndEta(
  pickup: LatLng,
  dropoff: LatLng
): Promise<{ distanceMiles: number; etaMinutes: number }> {
  const route = await drivingRoute(pickup, dropoff);
  const distanceMiles = metersToMiles(route.distanceMeters);
  const etaMinutes = Math.round(route.durationSeconds / 60);

  return { distanceMiles, etaMinutes };
}
