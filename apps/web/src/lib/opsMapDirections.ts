import { metersToMiles } from "@/lib/deliveryPricing";
import { checkRateLimit } from "@/lib/apiRateLimit";
import { cacheGet, cacheSet } from "@/lib/memoryCache";
import { getServerMapboxToken } from "@/lib/mapboxToken";

const MAPBOX_DIRECTIONS_URL =
  "https://api.mapbox.com/directions/v5/mapbox/driving";

export const OPS_ROUTE_CACHE_TTL_MS = 20_000;
export const OPS_ROUTE_MOVE_THRESHOLD_M = 75;
/** Soft cap of Directions calls per process per minute (ops map only). */
export const OPS_ROUTE_DIRECTIONS_LIMIT_PER_MIN = 40;

export type LatLng = { lat: number; lng: number };

export type OpsMapRouteResult = {
  coordinates: [number, number][];
  etaMinutes: number | null;
  distanceMiles: number | null;
  source: "mapbox" | "cache" | "straight";
};

type CachedRoute = OpsMapRouteResult & {
  origin: LatLng;
  waypointKey: string;
  fetchedAt: number;
};

function round4(n: number): string {
  return n.toFixed(4);
}

function waypointKey(waypoints: LatLng[]): string {
  return waypoints.map((w) => `${round4(w.lat)},${round4(w.lng)}`).join(">");
}

export function opsRouteCacheKey(
  missionId: string,
  _waypoints?: LatLng[]
): string {
  return `ops-route:${missionId}`;
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function straightLineRoute(
  waypoints: LatLng[],
  fallbackEtaMinutes?: number | null
): OpsMapRouteResult {
  const coordinates = waypoints.map(
    (w) => [w.lng, w.lat] as [number, number]
  );
  let meters = 0;
  for (let i = 1; i < waypoints.length; i++) {
    meters += haversineMeters(waypoints[i - 1]!, waypoints[i]!);
  }
  const etaFromDistance =
    meters > 0 ? Math.max(1, Math.round(meters / 8.3 / 60)) : null;
  return {
    coordinates,
    etaMinutes:
      fallbackEtaMinutes != null && Number.isFinite(fallbackEtaMinutes)
        ? Math.round(fallbackEtaMinutes)
        : etaFromDistance,
    distanceMiles: meters > 0 ? metersToMiles(meters) : null,
    source: "straight",
  };
}

/**
 * Mapbox Directions with simplified GeoJSON geometry for Live Map.
 * Fail-soft for ops: callers should fall back to straightLineRoute.
 */
export async function fetchDrivingRouteWithGeometry(
  waypoints: LatLng[]
): Promise<{
  coordinates: [number, number][];
  etaMinutes: number;
  distanceMiles: number;
}> {
  if (waypoints.length < 2) {
    throw new Error("Need at least 2 waypoints");
  }

  let accessToken: string;
  try {
    accessToken = getServerMapboxToken();
  } catch {
    throw new Error("MAPBOX_ACCESS_TOKEN missing");
  }

  const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(";");
  const url = `${MAPBOX_DIRECTIONS_URL}/${coords}?alternatives=false&geometries=geojson&overview=simplified&access_token=${encodeURIComponent(accessToken)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Mapbox Directions unavailable (${res.status})`);
  }

  const json = (await res.json().catch(() => null)) as {
    routes?: Array<{
      distance?: number;
      duration?: number;
      geometry?: { coordinates?: [number, number][] };
    }>;
  } | null;

  const route = json?.routes?.[0];
  const geometry = route?.geometry?.coordinates;
  if (
    !route ||
    !Array.isArray(geometry) ||
    geometry.length < 2 ||
    !Number.isFinite(route.distance) ||
    !Number.isFinite(route.duration)
  ) {
    throw new Error("Mapbox Directions returned no usable route");
  }

  return {
    coordinates: geometry,
    etaMinutes: Math.max(1, Math.round(Number(route.duration) / 60)),
    distanceMiles: metersToMiles(Number(route.distance)),
  };
}

/**
 * Resolve a Live Map route with cache, movement threshold, and rate limits.
 * Falls back to a straight polyline when Directions is unavailable.
 */
export async function resolveOpsMapDrivingRoute(params: {
  missionId: string;
  waypoints: LatLng[];
  fallbackEtaMinutes?: number | null;
}): Promise<OpsMapRouteResult> {
  const waypoints = params.waypoints.filter(
    (w) =>
      Number.isFinite(w.lat) &&
      Number.isFinite(w.lng) &&
      !(w.lat === 0 && w.lng === 0)
  );

  if (waypoints.length < 2) {
    return straightLineRoute(waypoints, params.fallbackEtaMinutes);
  }

  const origin = waypoints[0]!;
  const key = opsRouteCacheKey(params.missionId);
  const destKey = waypointKey(waypoints);
  const cached = cacheGet<CachedRoute>(key);
  if (cached) {
    const moved = haversineMeters(cached.origin, origin);
    if (
      moved < OPS_ROUTE_MOVE_THRESHOLD_M &&
      cached.waypointKey === destKey
    ) {
      return {
        coordinates: cached.coordinates,
        etaMinutes: cached.etaMinutes,
        distanceMiles: cached.distanceMiles,
        source: "cache",
      };
    }
  }

  const rl = checkRateLimit({
    namespace: "ops-map:directions",
    key: "global",
    limit: OPS_ROUTE_DIRECTIONS_LIMIT_PER_MIN,
    windowMs: 60_000,
  });
  if (rl.limited) {
    if (cached) {
      return {
        coordinates: cached.coordinates,
        etaMinutes: cached.etaMinutes,
        distanceMiles: cached.distanceMiles,
        source: "cache",
      };
    }
    return straightLineRoute(waypoints, params.fallbackEtaMinutes);
  }

  try {
    const route = await fetchDrivingRouteWithGeometry(waypoints);
    const value: CachedRoute = {
      coordinates: route.coordinates,
      etaMinutes: route.etaMinutes,
      distanceMiles: route.distanceMiles,
      source: "mapbox",
      origin,
      waypointKey: destKey,
      fetchedAt: Date.now(),
    };
    cacheSet(key, value, OPS_ROUTE_CACHE_TTL_MS);
    return {
      coordinates: value.coordinates,
      etaMinutes: value.etaMinutes,
      distanceMiles: value.distanceMiles,
      source: "mapbox",
    };
  } catch {
    if (cached) {
      return {
        coordinates: cached.coordinates,
        etaMinutes: cached.etaMinutes,
        distanceMiles: cached.distanceMiles,
        source: "cache",
      };
    }
    return straightLineRoute(waypoints, params.fallbackEtaMinutes);
  }
}

/** Bounded parallel map for Directions jobs (keeps ops-map latency predictable). */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length || 1)) },
    async () => {
      while (next < items.length) {
        const i = next;
        next += 1;
        results[i] = await worker(items[i]!, i);
      }
    }
  );
  await Promise.all(runners);
  return results;
}
