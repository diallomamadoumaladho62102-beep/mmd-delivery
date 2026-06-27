import type { NavigationTrip } from "./driverNavigation/types";
import type { CoordinatePoint } from "./coordinates";
import { distanceMeters } from "./coordinates";

export const DRIVER_NAV_PREVIEW_ORDER_ID = "__preview__";

/** Points le long de la route Mapbox preview (manœuvres réelles). */
export const DRIVER_NAV_PREVIEW_SCENARIOS = {
  straight: 0.05,
  turnRight: 0.12,
  turnLeft: 0.91,
  intersection: 0.875,
} as const;

export type DriverNavPreviewScenario = keyof typeof DRIVER_NAV_PREVIEW_SCENARIOS;

export function parseDriverNavPreviewProgress(
  value: unknown,
): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, parsed));
}

export function parsePreviewProgressFromUrl(
  url: string | null | undefined,
): number | null {
  if (!url) return null;
  try {
    const decoded = decodeURIComponent(url);
    const match = decoded.match(/[?&]previewProgress=([\d.]+)/i);
    if (!match?.[1]) return null;
    return parseDriverNavPreviewProgress(match[1]);
  } catch {
    return null;
  }
}

export function readEnvPreviewProgress(): number | null {
  if (!__DEV__) return null;
  return parseDriverNavPreviewProgress(
    process.env.EXPO_PUBLIC_DRIVER_NAV_PREVIEW_PROGRESS,
  );
}

/** Trip démo MMD — coordonnées réelles, route via Mapbox Directions. */
export const DRIVER_NAV_PREVIEW_TRIP: NavigationTrip = {
  orderId: DRIVER_NAV_PREVIEW_ORDER_ID,
  sourceTable: "delivery_requests",
  restaurantName: "MMD Delivery",
  pickupAddress: "450 Clarendon Rd, Brooklyn, NY",
  dropoffAddress: "1112 Flatbush Ave, Brooklyn, NY",
  pickup: { latitude: 40.6458, longitude: -73.9512 },
  dropoff: { latitude: 40.6439, longitude: -73.9574 },
  stage: "dropoff",
  price: 18.5,
  distanceMiles: 4.3,
  etaMinutes: 25,
  orderCountryCode: "US",
  pickupLocationId: null,
  dropoffLocationId: null,
};

const FALLBACK_POINT: CoordinatePoint = {
  latitude: 40.6458,
  longitude: -73.9512,
};

export function isDriverNavigationPreviewOrderId(orderId: string): boolean {
  return __DEV__ && orderId === DRIVER_NAV_PREVIEW_ORDER_ID;
}

function bearingBetween(start: CoordinatePoint, end: CoordinatePoint): number {
  const dLon = ((end.longitude - start.longitude) * Math.PI) / 180;
  const lat1 = (start.latitude * Math.PI) / 180;
  const lat2 = (end.latitude * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Simule le GPS MMD le long de la route Mapbox (preview dev uniquement). */
export function getPreviewPointAlongRoute(
  geometry: GeoJSON.Feature<GeoJSON.LineString> | null | undefined,
  progressRatio: number,
): { point: CoordinatePoint; heading: number; speedMps: number } {
  const coords = geometry?.geometry?.coordinates;
  if (!coords || coords.length < 2) {
    return { point: FALLBACK_POINT, heading: 0, speedMps: 8 };
  }

  let total = 0;
  const segmentLengths: number[] = [];
  for (let i = 0; i < coords.length - 1; i += 1) {
    const len = distanceMeters(
      Number(coords[i][1]),
      Number(coords[i][0]),
      Number(coords[i + 1][1]),
      Number(coords[i + 1][0]),
    );
    segmentLengths.push(len);
    total += len;
  }

  const target = Math.max(0, Math.min(1, progressRatio)) * total;
  let walked = 0;

  for (let i = 0; i < segmentLengths.length; i += 1) {
    const segLen = segmentLengths[i] ?? 0;
    if (walked + segLen >= target || i === segmentLengths.length - 1) {
      const t = segLen > 0 ? (target - walked) / segLen : 0;
      const start = {
        latitude: Number(coords[i][1]),
        longitude: Number(coords[i][0]),
      };
      const end = {
        latitude: Number(coords[i + 1][1]),
        longitude: Number(coords[i + 1][0]),
      };
      return {
        point: {
          latitude: start.latitude + t * (end.latitude - start.latitude),
          longitude: start.longitude + t * (end.longitude - start.longitude),
        },
        heading: bearingBetween(start, end),
        speedMps: 8.5,
      };
    }
    walked += segLen;
  }

  const last = coords[coords.length - 1];
  const prev = coords[coords.length - 2];
  return {
    point: { latitude: Number(last[1]), longitude: Number(last[0]) },
    heading: bearingBetween(
      { latitude: Number(prev[1]), longitude: Number(prev[0]) },
      { latitude: Number(last[1]), longitude: Number(last[0]) },
    ),
    speedMps: 8.5,
  };
}
