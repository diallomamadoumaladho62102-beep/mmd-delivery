import { useCallback, useEffect, useState } from "react";
import {
  DRIVER_MAP_REPORTS,
  DEFAULT_DRIVER_MAP_REPORT_CONTEXT,
  isSupportedCountryCode,
  type DriverMapCountryCode,
  type DriverMapModuleType,
} from "../lib/driverNavigation/reports/config";
import { fetchNearbyDriverMapReports } from "../lib/driverNavigation/reports/service";

type Params = {
  enabled: boolean;
  latitude: number | null;
  longitude: number | null;
  countryCode?: DriverMapCountryCode;
  moduleType?: DriverMapModuleType;
};

export function useNearbyDriverMapReports(params: Params) {
  const {
    enabled,
    latitude,
    longitude,
    countryCode = DEFAULT_DRIVER_MAP_REPORT_CONTEXT.countryCode,
    moduleType = DEFAULT_DRIVER_MAP_REPORT_CONTEXT.moduleType,
  } = params;

  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled || !DRIVER_MAP_REPORTS.enabled) {
      setCount(0);
      return;
    }

    if (latitude == null || longitude == null || !isSupportedCountryCode(countryCode)) {
      setCount(0);
      return;
    }

    setLoading(true);
    try {
      const result = await fetchNearbyDriverMapReports({
        latitude,
        longitude,
        countryCode,
        moduleType,
      });
      setCount(result.reports.length);
    } finally {
      setLoading(false);
    }
  }, [countryCode, enabled, latitude, longitude, moduleType]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled || !DRIVER_MAP_REPORTS.enabled) return;

    const timer = setInterval(() => {
      void refresh();
    }, DRIVER_MAP_REPORTS.nearbyRefreshMs);

    return () => clearInterval(timer);
  }, [enabled, refresh]);

  return { count, loading, refresh };
}
