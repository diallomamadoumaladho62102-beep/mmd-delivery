import { useCallback, useEffect, useRef, useState } from "react";
import {
  defaultPlatformFeatures,
  fetchRestaurantPlatformFeatures,
  type PlatformFeaturesResponse,
} from "../lib/platformFeaturesApi";

export function useRestaurantPlatformFeatures() {
  const [features, setFeatures] = useState<PlatformFeaturesResponse>(defaultPlatformFeatures());
  const [loading, setLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchRestaurantPlatformFeatures();
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
