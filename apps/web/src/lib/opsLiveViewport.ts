/**
 * Viewport math for the staff Live Operations map.
 * Coordinates must already be authorized operational points. This module
 * does not fetch locations and does not invent positions.
 */

export type OpsLngLat = { lng: number; lat: number };

export type OpsViewport = {
  longitude: number;
  latitude: number;
  zoom: number;
  bounds: {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
  } | null;
};

/** Metro view over New York / Nassau when nothing active is on the map. */
export const OPS_NEUTRAL_VIEWPORT: OpsViewport = {
  longitude: -73.72,
  latitude: 40.73,
  zoom: 10.4,
  bounds: null,
};

const SINGLE_ZOOM = 14;
const MIN_ZOOM = 4;
const MAX_ZOOM = 14.5;
const OUTLIER_KM = 800;

export function isValidOpsCoordinate(lng: unknown, lat: unknown): boolean {
  const longitude = Number(lng);
  const latitude = Number(lat);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return false;
  if (latitude < -85 || latitude > 85) return false;
  if (longitude < -180 || longitude > 180) return false;
  if (Math.abs(latitude) < 0.01 && Math.abs(longitude) < 0.01) return false;
  return true;
}

function toPoint(point: OpsLngLat): OpsLngLat | null {
  if (!isValidOpsCoordinate(point.lng, point.lat)) return null;
  return { lng: Number(point.lng), lat: Number(point.lat) };
}

function haversineKm(a: OpsLngLat, b: OpsLngLat): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Drop a lone point that sits far from every other point. Keep real multi-city sets. */
export function dropIsolatedOutliers(points: OpsLngLat[]): OpsLngLat[] {
  if (points.length < 3) return points;
  const kept = points.filter((point) => {
    let nearest = Number.POSITIVE_INFINITY;
    for (const other of points) {
      if (other === point) continue;
      nearest = Math.min(nearest, haversineKm(point, other));
    }
    return nearest <= OUTLIER_KM;
  });
  if (kept.length === 0 || kept.length === points.length) return points;
  return dropIsolatedOutliers(kept);
}

function boundsOf(points: OpsLngLat[]) {
  let minLng = 180;
  let maxLng = -180;
  let minLat = 90;
  let maxLat = -90;
  for (const point of points) {
    minLng = Math.min(minLng, point.lng);
    maxLng = Math.max(maxLng, point.lng);
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
  }
  return { minLng, maxLng, minLat, maxLat };
}

export function viewportForCoordinates(points: OpsLngLat[]): OpsViewport {
  const valid = points
    .map(toPoint)
    .filter((point): point is OpsLngLat => point != null);
  const focused = dropIsolatedOutliers(valid);
  if (focused.length === 0) return { ...OPS_NEUTRAL_VIEWPORT };
  if (focused.length === 1) {
    const point = focused[0];
    const pad = 0.02;
    return {
      longitude: point.lng,
      latitude: point.lat,
      zoom: SINGLE_ZOOM,
      bounds: {
        minLng: point.lng - pad,
        maxLng: point.lng + pad,
        minLat: point.lat - pad,
        maxLat: point.lat + pad,
      },
    };
  }
  const bounds = boundsOf(focused);
  const spanLng = Math.max(bounds.maxLng - bounds.minLng, 0.01);
  const spanLat = Math.max(bounds.maxLat - bounds.minLat, 0.01);
  const zoom = Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, Math.min(Math.log2(360 / (spanLng * 1.8)), Math.log2(170 / (spanLat * 1.8)))),
  );
  return {
    longitude: (bounds.minLng + bounds.maxLng) / 2,
    latitude: (bounds.minLat + bounds.maxLat) / 2,
    zoom,
    bounds,
  };
}

export function viewportContains(view: OpsViewport, point: OpsLngLat): boolean {
  if (!view.bounds || !isValidOpsCoordinate(point.lng, point.lat)) return false;
  return (
    point.lng >= view.bounds.minLng &&
    point.lng <= view.bounds.maxLng &&
    point.lat >= view.bounds.minLat &&
    point.lat <= view.bounds.maxLat
  );
}

export type ViewportFitReason = "load" | "filter" | "refresh" | "manual-fit" | "select";

/** Refresh never moves the camera. A manual pan/zoom blocks the next automatic load fit. */
export function shouldAutoFitViewport(input: {
  userAdjusted: boolean;
  reason: ViewportFitReason;
}): boolean {
  if (input.reason === "refresh") return false;
  if (input.reason === "manual-fit" || input.reason === "select") return true;
  if (input.reason === "filter") return true;
  return !input.userAdjusted;
}
