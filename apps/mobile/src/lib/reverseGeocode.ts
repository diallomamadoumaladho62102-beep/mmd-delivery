import * as Location from "expo-location";
import { getApiBaseUrl } from "./apiBase";
import { getMapboxAuthHeaders } from "./mapboxComputeDistance";
import {
  formatCoordAddress,
  reverseGeocodeCacheKey,
} from "./reverseGeocodePure";

export type ReverseGeocodeResult = {
  fullAddress: string;
  shortName: string;
  latitude: number;
  longitude: number;
  source: "mapbox" | "device" | "coords";
};

export type ReverseGeocodeOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  skipCache?: boolean;
};

export { formatCoordAddress, reverseGeocodeCacheKey };

const CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 6000;

type CacheEntry = {
  value: ReverseGeocodeResult;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

function coordsFallback(lat: number, lng: number): ReverseGeocodeResult {
  const addr = formatCoordAddress(lat, lng);
  return {
    fullAddress: addr,
    shortName: addr,
    latitude: lat,
    longitude: lng,
    source: "coords",
  };
}

function formatDeviceAddress(
  place: Location.LocationGeocodedAddress,
  lat: number,
  lng: number
): { fullAddress: string; shortName: string } {
  const street = [place.streetNumber, place.street].filter(Boolean).join(" ").trim();
  const shortName = street || place.name || formatCoordAddress(lat, lng);
  const parts = [
    street || place.name,
    place.city || place.subregion,
    place.region,
    place.postalCode,
    place.country,
  ].filter(Boolean);
  const fullAddress =
    parts.length > 0 ? parts.join(", ") : formatCoordAddress(lat, lng);
  return { fullAddress, shortName };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

async function tryMapboxReverse(
  lat: number,
  lng: number,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<ReverseGeocodeResult | null> {
  const base = getApiBaseUrl().replace(/\/+$/, "");
  const headers = await getMapboxAuthHeaders();
  const doFetch = () =>
    fetchWithTimeout(
      `${base}/api/mapbox/reverse`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ latitude: lat, longitude: lng }),
      },
      timeoutMs,
      signal
    );

  let res: Response;
  try {
    res = await doFetch();
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError" && signal?.aborted) {
      return null;
    }
    // One retry for network abort / timeout
    try {
      res = await doFetch();
    } catch {
      return null;
    }
  }

  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    fullAddress?: string;
    shortName?: string;
    latitude?: number;
    longitude?: number;
  } | null;

  if (!res.ok || !json?.ok) return null;

  const fullAddress = String(json.fullAddress ?? "").trim();
  if (!fullAddress) return null;

  return {
    fullAddress,
    shortName: String(json.shortName ?? fullAddress).trim() || fullAddress,
    latitude: Number.isFinite(Number(json.latitude)) ? Number(json.latitude) : lat,
    longitude: Number.isFinite(Number(json.longitude)) ? Number(json.longitude) : lng,
    source: "mapbox",
  };
}

async function tryDeviceReverse(
  lat: number,
  lng: number
): Promise<ReverseGeocodeResult | null> {
  try {
    const places = await Location.reverseGeocodeAsync({
      latitude: lat,
      longitude: lng,
    });
    const place = places[0];
    if (!place) return null;
    const formatted = formatDeviceAddress(place, lat, lng);
    if (!formatted.fullAddress.trim()) return null;
    return {
      ...formatted,
      latitude: lat,
      longitude: lng,
      source: "device",
    };
  } catch {
    return null;
  }
}

/**
 * Never throws for empty address — always returns at least a coordinate string.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  opts: ReverseGeocodeOptions = {}
): Promise<ReverseGeocodeResult> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return coordsFallback(0, 0);
  }

  const key = reverseGeocodeCacheKey(lat, lng);
  if (!opts.skipCache) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.value;
    }
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const fromApi = await tryMapboxReverse(lat, lng, timeoutMs, opts.signal);
  if (fromApi) {
    cache.set(key, { value: fromApi, expiresAt: Date.now() + CACHE_TTL_MS });
    return fromApi;
  }

  const fromDevice = await tryDeviceReverse(lat, lng);
  if (fromDevice) {
    cache.set(key, { value: fromDevice, expiresAt: Date.now() + CACHE_TTL_MS });
    return fromDevice;
  }

  const fallback = coordsFallback(lat, lng);
  cache.set(key, { value: fallback, expiresAt: Date.now() + CACHE_TTL_MS });
  return fallback;
}

/** Test helper — clear in-memory cache. */
export function clearReverseGeocodeCache(): void {
  cache.clear();
}
