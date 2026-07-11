import { useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../lib/supabase";
import type { RoadSafetyEvent } from "../lib/roadSafety";
import {
  DEFAULT_RUNTIME_CONFIG,
  type RoadSafetyRuntimeConfig,
} from "../lib/roadSafetyConfig";
import {
  bboxForRoute,
  isCacheFresh,
  safetyCacheKey,
  type CachedSafetyPayload,
} from "../lib/roadSafetyCache";
import { fetchRoadSafetyEvents } from "../lib/roadSafetyRemote";

const CACHE_TTL_MS = 6 * 3600_000;

type Params = {
  enabled: boolean;
  routeGeometry: GeoJSON.Feature<GeoJSON.LineString> | null | undefined;
  countryCode: string | null | undefined;
};

export type UseRoadSafetyEventsResult = {
  events: RoadSafetyEvent[];
  config: RoadSafetyRuntimeConfig;
  attribution: string | null;
};

/**
 * Fetches road-safety events for the current route's bounding box + country via
 * the Edge Function, with an AsyncStorage TTL cache and graceful fallback to
 * the last cached payload when the network/backend is unavailable. Refetches
 * when the route (bbox tile) changes, i.e. after a reroute.
 */
export function useRoadSafetyEvents({
  enabled,
  routeGeometry,
  countryCode,
}: Params): UseRoadSafetyEventsResult {
  const [events, setEvents] = useState<RoadSafetyEvent[]>([]);
  const [config, setConfig] = useState<RoadSafetyRuntimeConfig>(DEFAULT_RUNTIME_CONFIG);
  const [attribution, setAttribution] = useState<string | null>(null);
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setEvents([]);
      return;
    }
    const bbox = bboxForRoute(routeGeometry);
    if (!bbox) return;

    const normalizedCountry = (countryCode ?? "").trim().toUpperCase() || null;
    const key = safetyCacheKey(bbox, normalizedCountry);
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;

    let cancelled = false;

    const applyCacheFallback = async () => {
      try {
        const cachedRaw = await AsyncStorage.getItem(key);
        if (!cachedRaw || cancelled) return;
        const cached = JSON.parse(cachedRaw) as CachedSafetyPayload;
        setEvents(cached.events ?? []);
      } catch {
        // ignore malformed cache
      }
    };

    const run = async () => {
      // Serve fresh cache immediately when available.
      try {
        const cachedRaw = await AsyncStorage.getItem(key);
        if (cachedRaw && !cancelled) {
          const cached = JSON.parse(cachedRaw) as CachedSafetyPayload;
          if (isCacheFresh(cached, CACHE_TTL_MS)) {
            setEvents(cached.events ?? []);
          }
        }
      } catch {
        // ignore
      }

      try {
        const result = await fetchRoadSafetyEvents(supabase, {
          bbox,
          countryCode: normalizedCountry,
        });
        if (cancelled) return;
        setEvents(result.events);
        setConfig(result.config);
        setAttribution(result.attribution);
        const payload: CachedSafetyPayload = {
          fetchedAt: Date.now(),
          events: result.events,
          config: result.config,
        };
        void AsyncStorage.setItem(key, JSON.stringify(payload));
      } catch {
        // Network/backend failure → keep last cached events.
        await applyCacheFallback();
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [enabled, routeGeometry, countryCode]);

  return { events, config, attribution };
}
