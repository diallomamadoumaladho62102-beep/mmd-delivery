import {
  clearLiveEtaCache,
  getCachedLiveEta,
  getLiveEtaCacheEntry,
  haversineLiveEta,
  isValidLiveEtaPoint,
  liveEtaCacheKey,
  markLiveEtaNetwork,
  setLiveEtaCacheForTest,
  setLiveEtaCacheValue,
  shouldThrottleLiveEtaNetwork,
  type LiveEtaPoint,
  type LiveEtaResult,
  LIVE_ETA_CACHE_TTL_MS,
  LIVE_ETA_MIN_INTERVAL_MS,
  createLiveEtaSession,
  etaFromHaversine,
  haversineMeters,
  haversineMiles,
  roundCoordKey,
} from "./mapboxLiveEtaCore";

export type { LiveEtaPoint, LiveEtaResult };
export {
  clearLiveEtaCache,
  createLiveEtaSession,
  etaFromHaversine,
  getLiveEtaCacheEntry,
  haversineLiveEta,
  haversineMeters,
  haversineMiles,
  liveEtaCacheKey,
  LIVE_ETA_CACHE_TTL_MS,
  LIVE_ETA_MIN_INTERVAL_MS,
  roundCoordKey,
  setLiveEtaCacheForTest,
};

/**
 * Live ETA with short cache + throttle. Prefers Mapbox Directions via
 * fetchNavigationRoute; falls back to haversine on failure.
 */
export async function fetchLiveEta(params: {
  from: LiveEtaPoint;
  to: LiveEtaPoint;
  signal?: AbortSignal;
  forceNetwork?: boolean;
}): Promise<LiveEtaResult> {
  const { from, to, signal } = params;
  if (!isValidLiveEtaPoint(from) || !isValidLiveEtaPoint(to)) {
    return {
      etaMinutes: 1,
      distanceMiles: 0,
      distanceMeters: 0,
      geometry: null,
      source: "haversine",
      nextStep: null,
    };
  }

  const key = liveEtaCacheKey(from, to);
  const now = Date.now();
  const cachedFresh = getCachedLiveEta(key, now);

  if (cachedFresh && !params.forceNetwork) {
    return cachedFresh;
  }

  const cachedAny = getLiveEtaCacheEntry(key)?.value;
  if (
    !params.forceNetwork &&
    cachedAny &&
    shouldThrottleLiveEtaNetwork(key, now)
  ) {
    return cachedAny;
  }

  markLiveEtaNetwork(key, now);

  try {
    if (signal?.aborted) {
      return cachedAny ?? haversineLiveEta(from, to);
    }

    // Dynamic import keeps pure tests free of @rnmapbox/maps / react-native.
    const { fetchNavigationRoute } = await import("./navigationService");
    const route = await fetchNavigationRoute(from, to, [], signal);
    if (route) {
      const value: LiveEtaResult = {
        etaMinutes: route.etaMinutes,
        distanceMiles: route.distanceMeters / 1609.344,
        distanceMeters: route.distanceMeters,
        geometry: route.geometry,
        source: "mapbox",
        nextStep: route.steps[0]?.instruction ?? null,
      };
      setLiveEtaCacheValue(key, value);
      return value;
    }
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") {
      return cachedAny ?? haversineLiveEta(from, to);
    }
  }

  const fallback = haversineLiveEta(from, to);
  setLiveEtaCacheValue(key, fallback);
  return fallback;
}
