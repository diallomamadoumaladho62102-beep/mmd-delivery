import { metersToMiles } from "@/lib/deliveryPricing";
import { getServerMapboxToken } from "@/lib/mapboxToken";

const MAPBOX_DIRECTIONS_URL =
  "https://api.mapbox.com/directions/v5/mapbox/driving";

type LatLng = {
  lat: number;
  lng: number;
};

/**
 * Server-only Mapbox Directions for paid food/errand quotes.
 * Uses MAPBOX_ACCESS_TOKEN only — never the public client token.
 * Fail-closed: throws when token missing or Directions fails (no Haversine).
 */
export async function getDistanceAndEta(
  pickup: LatLng,
  dropoff: LatLng
): Promise<{ distanceMiles: number; etaMinutes: number }> {
  let accessToken: string;
  try {
    accessToken = getServerMapboxToken();
  } catch {
    throw new Error("MAPBOX_ACCESS_TOKEN missing");
  }

  const coords = `${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}`;
  const url = `${MAPBOX_DIRECTIONS_URL}/${coords}?alternatives=false&geometries=geojson&overview=simplified&access_token=${encodeURIComponent(accessToken)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Mapbox Directions unavailable (${res.status})`);
  }

  const json = (await res.json().catch(() => null)) as {
    routes?: Array<{ distance?: number; duration?: number }>;
  } | null;

  const route = json?.routes?.[0];
  if (!route || !Number.isFinite(route.distance) || !Number.isFinite(route.duration)) {
    throw new Error("Mapbox Directions returned no usable route");
  }

  // Mapbox returns meters — never treat as km or miles. Canonical factor: 1609.34.
  const distanceMiles = metersToMiles(Number(route.distance));
  const etaMinutes = Math.round(Number(route.duration) / 60);

  return { distanceMiles, etaMinutes };
}
