import type { CoordinatePoint } from "./coordinates";
import { distanceMeters } from "./coordinates";

export type LiveEtaPoint = CoordinatePoint;

export type LiveEtaResult = {
  etaMinutes: number;
  distanceMiles: number;
  distanceMeters: number;
  geometry: GeoJSON.Feature<GeoJSON.LineString> | null;
  source: "mapbox" | "haversine";
  nextStep?: string | null;
};

export const LIVE_ETA_CACHE_TTL_MS = 20_000;
export const LIVE_ETA_MIN_INTERVAL_MS = 8_000;
const DEFAULT_SPEED_MPS = 8.3; // ~18.5 mph urban approx

type CacheEntry = {
  value: LiveEtaResult;
  fetchedAt: number;
};

const etaCache = new Map<string, CacheEntry>();
const lastNetworkAt = new Map<string, number>();

export function roundCoordKey(point: LiveEtaPoint, decimals = 4): string {
  return `${point.latitude.toFixed(decimals)},${point.longitude.toFixed(decimals)}`;
}

export function liveEtaCacheKey(from: LiveEtaPoint, to: LiveEtaPoint): string {
  return `${roundCoordKey(from)}->${roundCoordKey(to)}`;
}

export function haversineMeters(a: LiveEtaPoint, b: LiveEtaPoint): number {
  return distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude);
}

export function haversineMiles(a: LiveEtaPoint, b: LiveEtaPoint): number {
  return haversineMeters(a, b) / 1609.344;
}

export function etaFromHaversine(
  meters: number,
  speedMps: number = DEFAULT_SPEED_MPS
): number {
  if (!Number.isFinite(meters) || meters <= 0) return 1;
  const speed = Number.isFinite(speedMps) && speedMps > 0 ? speedMps : DEFAULT_SPEED_MPS;
  return Math.max(1, Math.round(meters / speed / 60));
}

export function haversineLiveEta(from: LiveEtaPoint, to: LiveEtaPoint): LiveEtaResult {
  const meters = haversineMeters(from, to);
  return {
    etaMinutes: etaFromHaversine(meters),
    distanceMiles: meters / 1609.344,
    distanceMeters: meters,
    geometry: null,
    source: "haversine",
    nextStep: null,
  };
}

export function createLiveEtaSession() {
  let generation = 0;

  return {
    nextGeneration(): number {
      generation += 1;
      return generation;
    },
    isCurrent(gen: number): boolean {
      return gen === generation;
    },
    get generation() {
      return generation;
    },
  };
}

export function isValidLiveEtaPoint(p: LiveEtaPoint | null | undefined): p is LiveEtaPoint {
  return (
    !!p &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    !(p.latitude === 0 && p.longitude === 0)
  );
}

export function getCachedLiveEta(
  key: string,
  now = Date.now()
): LiveEtaResult | null {
  const cached = etaCache.get(key);
  if (!cached) return null;
  if (now - cached.fetchedAt >= LIVE_ETA_CACHE_TTL_MS) return null;
  return cached.value;
}

export function shouldThrottleLiveEtaNetwork(
  key: string,
  now = Date.now()
): boolean {
  const lastNet = lastNetworkAt.get(key) ?? 0;
  return now - lastNet < LIVE_ETA_MIN_INTERVAL_MS;
}

export function markLiveEtaNetwork(key: string, now = Date.now()): void {
  lastNetworkAt.set(key, now);
}

export function setLiveEtaCacheValue(
  key: string,
  value: LiveEtaResult,
  fetchedAt = Date.now()
): void {
  etaCache.set(key, { value, fetchedAt });
}

export function getLiveEtaCacheEntry(key: string): CacheEntry | undefined {
  return etaCache.get(key);
}

export function clearLiveEtaCache(): void {
  etaCache.clear();
  lastNetworkAt.clear();
}

export function setLiveEtaCacheForTest(
  key: string,
  value: LiveEtaResult,
  fetchedAt = Date.now()
): void {
  etaCache.set(key, { value, fetchedAt });
  lastNetworkAt.set(key, fetchedAt);
}
