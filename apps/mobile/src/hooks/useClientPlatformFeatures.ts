import { useCallback, useEffect, useRef, useState } from "react";
import * as Location from "expo-location";
import {
  defaultPlatformFeatures,
  fetchClientPlatformFeatures,
  type PlatformFeaturesResponse,
} from "../lib/platformFeaturesApi";

type UseClientPlatformFeaturesOptions = {
  enabled?: boolean;
};

export function useClientPlatformFeatures(options: UseClientPlatformFeaturesOptions = {}) {
  const enabled = options.enabled !== false;
  const [features, setFeatures] = useState<PlatformFeaturesResponse>(defaultPlatformFeatures());
  const [loading, setLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      let lat: number | undefined;
      let lng: number | undefined;

      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (permission.granted) {
          const position = await Location.getLastKnownPositionAsync();
          if (position?.coords) {
            lat = position.coords.latitude;
            lng = position.coords.longitude;
          }
        }
      } catch {
        // GPS optional — saved address fallback on server
      }

      const next = await fetchClientPlatformFeatures({ lat, lng });
      setFeatures(next.ok ? next : defaultPlatformFeatures());
    } catch {
      setFeatures(defaultPlatformFeatures());
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const ms = features.refresh_after_ms ?? 300_000;
    refreshTimerRef.current = setTimeout(() => {
      void refresh();
    }, ms);
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [features.refresh_after_ms, refresh]);

  return { features, loading, refresh };
}
