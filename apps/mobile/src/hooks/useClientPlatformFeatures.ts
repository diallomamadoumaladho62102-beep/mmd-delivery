import { useCallback, useEffect, useRef, useState } from "react";
import * as Location from "expo-location";
import {
  CLIENT_SCREEN_FETCH_TIMEOUT_MS,
  withTimeout,
} from "../lib/bootFailOpen";
import {
  defaultPlatformFeatures,
  fetchClientPlatformFeatures,
  type PlatformFeaturesResponse,
} from "../lib/platformFeaturesApi";
import { clearManualClientScope, readManualClientScope } from "../lib/clientScopeStorage";
import { readSelectedMarket } from "../lib/selectedMarketStore";
import { supabase } from "../lib/supabase";

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
      const position = await withTimeout(
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }),
        CLIENT_SCREEN_FETCH_TIMEOUT_MS,
        "client_platform_gps_fresh",
      );
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

    const position = await withTimeout(
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }),
      CLIENT_SCREEN_FETCH_TIMEOUT_MS,
      "client_platform_gps",
    );
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

      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id ?? null;

      // CountryWelcome / Settings → Pays: explicit market must not be overridden by
      // emulator/device GPS that still reports another country.
      const selectedMarket = refreshOptions.forceGps
        ? null
        : await readSelectedMarket();
      if (selectedMarket) {
        const next = await fetchClientPlatformFeatures({
          manualCountry: selectedMarket,
        });
        setFeatures(next.ok ? next : defaultPlatformFeatures());
        return;
      }

      const { lat, lng } = await readDeviceCoordinates(Boolean(refreshOptions.forceGps));

      let manualCountry: string | undefined;
      let manualState: string | undefined;

      if (!lat || !lng) {
        const manual = await readManualClientScope(userId);
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
