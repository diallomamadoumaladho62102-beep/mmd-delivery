import { useCallback, useEffect, useRef, useState } from "react";
import * as Location from "expo-location";
import {
  defaultPlatformFeatures,
  fetchClientPlatformFeatures,
  type PlatformFeaturesResponse,
} from "../lib/platformFeaturesApi";
import { clearManualClientScope, readManualClientScope } from "../lib/clientScopeStorage";

type UseClientPlatformFeaturesOptions = {
  enabled?: boolean;
};

type RefreshOptions = {
  forceGps?: boolean;
};

async function readDeviceCoordinates(forceFresh: boolean): Promise<{
  lat?: number;
  lng?: number;
}> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    let granted = permission.granted;

    if (!granted && forceFresh) {
      const requested = await Location.requestForegroundPermissionsAsync();
      granted = requested.granted;
    }

    if (!granted) return {};

    if (forceFresh) {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (position?.coords) {
        return {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
      }
    }

    const lastKnown = await Location.getLastKnownPositionAsync();
    if (lastKnown?.coords) {
      return {
        lat: lastKnown.coords.latitude,
        lng: lastKnown.coords.longitude,
      };
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    if (position?.coords) {
      return {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
    }
  } catch {
    // GPS optional
  }

  return {};
}

export function useClientPlatformFeatures(options: UseClientPlatformFeaturesOptions = {}) {
  const enabled = options.enabled !== false;
  const [features, setFeatures] = useState<PlatformFeaturesResponse>(defaultPlatformFeatures());
  const [loading, setLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async (refreshOptions: RefreshOptions = {}) => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      if (refreshOptions.forceGps) {
        await clearManualClientScope();
      }

      const { lat, lng } = await readDeviceCoordinates(Boolean(refreshOptions.forceGps));

      let manualCountry: string | undefined;
      let manualState: string | undefined;

      if (!lat || !lng) {
        const manual = await readManualClientScope();
        if (manual) {
          manualCountry = manual.countryCode;
          manualState = manual.stateCode ?? undefined;
        }
      }

      const next = await fetchClientPlatformFeatures({
        lat,
        lng,
        manualCountry,
        manualState,
      });
      setFeatures(next.ok ? next : defaultPlatformFeatures());
    } catch {
      setFeatures(defaultPlatformFeatures());
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  const refreshWithCurrentLocation = useCallback(async () => {
    await refresh({ forceGps: true });
  }, [refresh]);

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

  return { features, loading, refresh, refreshWithCurrentLocation };
}
