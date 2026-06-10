import { useCallback, useEffect, useRef, useState } from "react";
import * as Location from "expo-location";
import {
  defaultPlatformFeatures,
  fetchDriverPlatformFeatures,
  type PlatformFeaturesResponse,
} from "../lib/platformFeaturesApi";

export function useDriverPlatformFeatures() {
  const [features, setFeatures] = useState<PlatformFeaturesResponse>(defaultPlatformFeatures());
  const [loading, setLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async (coords?: { lat?: number; lng?: number }) => {
    setLoading(true);
    try {
      let lat = coords?.lat;
      let lng = coords?.lng;

      if (lat == null || lng == null) {
        try {
          const permission = await Location.getForegroundPermissionsAsync();
          if (permission.granted) {
            const position =
              (await Location.getLastKnownPositionAsync()) ??
              (await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
              }));
            lat = position?.coords.latitude;
            lng = position?.coords.longitude;
          }
        } catch {
          // optional GPS
        }
      }

      const next = await fetchDriverPlatformFeatures({ lat, lng });
      setFeatures(next.ok ? next : defaultPlatformFeatures());
      return next.ok ? next : defaultPlatformFeatures();
    } catch {
      const fallback = defaultPlatformFeatures();
      setFeatures(fallback);
      return fallback;
    } finally {
      setLoading(false);
    }
  }, []);

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
