/**
 * Pure helpers for the road-safety fetch layer: route bounding box, cache
 * freshness / keying, and de-duplicated merge of multi-source events.
 */
import type { RoadSafetyEvent } from "./roadSafety";
import type { RoadSafetyRuntimeConfig } from "./roadSafetyConfig";

export type Bbox = { south: number; west: number; north: number; east: number };

/** Bounding box of a route geometry, padded by `padMeters` (approx). */
export function bboxForRoute(
  geometry: GeoJSON.Feature<GeoJSON.LineString> | null | undefined,
  padMeters = 300,
): Bbox | null {
  const coords = geometry?.geometry?.coordinates;
  if (!coords?.length) return null;

  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const [lng, lat] of coords) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  }
  if (!Number.isFinite(south) || !Number.isFinite(west)) return null;

  const latPad = padMeters / 111_320;
  const midLat = (south + north) / 2;
  const lngPad = padMeters / (111_320 * Math.max(0.2, Math.cos((midLat * Math.PI) / 180)));

  return {
    south: south - latPad,
    west: west - lngPad,
    north: north + latPad,
    east: east + lngPad,
  };
}

/** Stable cache key for a route+country query (rounded bbox to reuse tiles). */
export function safetyCacheKey(bbox: Bbox, countryCode: string | null): string {
  const r = (v: number) => v.toFixed(2);
  return `mmd.road_safety.events.v1:${countryCode ?? "XX"}:${r(bbox.south)},${r(bbox.west)},${r(
    bbox.north,
  )},${r(bbox.east)}`;
}

export type CachedSafetyPayload = {
  fetchedAt: number;
  events: RoadSafetyEvent[];
  config: Partial<RoadSafetyRuntimeConfig> | null;
};

/** Is a cached payload still fresh for `ttlMs`? */
export function isCacheFresh(
  payload: Pick<CachedSafetyPayload, "fetchedAt"> | null | undefined,
  ttlMs: number,
  now = Date.now(),
): boolean {
  if (!payload || !Number.isFinite(payload.fetchedAt)) return false;
  return now - payload.fetchedAt < ttlMs;
}

/**
 * Merge events from multiple sources, de-duplicated by a stable identity.
 * Higher-confidence and more-recent entries win.
 */
export function mergeSafetyEvents(...batches: RoadSafetyEvent[][]): RoadSafetyEvent[] {
  const byId = new Map<string, RoadSafetyEvent>();
  for (const batch of batches) {
    for (const event of batch) {
      const key = event.id || `${event.type}:${event.coordinate.latitude.toFixed(5)}:${event.coordinate.longitude.toFixed(5)}`;
      const existing = byId.get(key);
      if (!existing) {
        byId.set(key, event);
        continue;
      }
      const better = (event.confidence ?? 0) > (existing.confidence ?? 0);
      if (better) byId.set(key, event);
    }
  }
  return [...byId.values()];
}
