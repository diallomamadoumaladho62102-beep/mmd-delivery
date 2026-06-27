import { useCallback, useEffect, useState } from "react";
import type { CoordinatePoint } from "../lib/coordinates";
import { distanceMeters } from "../lib/coordinates";
import {
  fetchNearbyDriverMapReports,
} from "../lib/driverNavigation/reports/service";
import {
  DRIVER_MAP_REPORTS,
  isSupportedCountryCode,
  type DriverMapCountryCode,
  type DriverMapReportCategory,
  type DriverMapModuleType,
} from "../lib/driverNavigation/reports/config";

export type DriverNavigationAlert = {
  id: string;
  message: string;
  distanceMeters: number;
  category: DriverMapReportCategory;
};

function formatAlertMessage(
  category: DriverMapReportCategory,
  distanceMeters: number,
  description?: string | null,
): string {
  const dist =
    distanceMeters < 1000
      ? `${Math.max(50, Math.round(distanceMeters / 10) * 10)} m`
      : `${(distanceMeters / 1000).toFixed(1)} km`;

  if (description?.trim()) {
    return `${description.trim()} dans ${dist}`;
  }

  switch (category) {
    case "traffic_jam":
      return `Embouteillage signalé dans ${dist}`;
    case "police":
      return `Contrôle signalé dans ${dist}`;
    case "accident":
      return `Accident signalé dans ${dist}`;
    case "road_closed":
      return `Route fermée dans ${dist}`;
    case "hazard":
      return `Danger signalé dans ${dist}`;
    case "bad_address":
      return `Adresse signalée dans ${dist}`;
    default:
      return `Alerte chauffeur dans ${dist}`;
  }
}

type Params = {
  enabled: boolean;
  point: CoordinatePoint | null;
  countryCode: string | null | undefined;
  moduleType?: DriverMapModuleType;
};

export function useDriverNavigationAlert(params: Params) {
  const { enabled, point, countryCode, moduleType = "delivery" } = params;
  const [alert, setAlert] = useState<DriverNavigationAlert | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled || !DRIVER_MAP_REPORTS.enabled || !point) {
      setAlert(null);
      return;
    }

    const code = String(countryCode ?? "").toUpperCase() as DriverMapCountryCode;
    if (!isSupportedCountryCode(code)) {
      setAlert(null);
      return;
    }

    const result = await fetchNearbyDriverMapReports({
      latitude: point.latitude,
      longitude: point.longitude,
      countryCode: code,
      moduleType,
      radiusMeters: 2500,
    });

    if (!result.reports.length) {
      setAlert(null);
      return;
    }

    const nearest = [...result.reports].sort((a, b) => {
      const da = distanceMeters(
        point.latitude,
        point.longitude,
        a.latitude,
        a.longitude,
      );
      const db = distanceMeters(
        point.latitude,
        point.longitude,
        b.latitude,
        b.longitude,
      );
      return da - db;
    })[0];

    if (!nearest) {
      setAlert(null);
      return;
    }

    const distance = distanceMeters(
      point.latitude,
      point.longitude,
      nearest.latitude,
      nearest.longitude,
    );

    if (distance > 2000) {
      setAlert(null);
      return;
    }

    setAlert({
      id: nearest.id,
      message: formatAlertMessage(
        nearest.category,
        distance,
        nearest.description,
      ),
      distanceMeters: distance,
      category: nearest.category,
    });
  }, [countryCode, enabled, moduleType, point]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;

    const timer = setInterval(() => {
      void refresh();
    }, DRIVER_MAP_REPORTS.nearbyRefreshMs);

    return () => clearInterval(timer);
  }, [enabled, refresh]);

  return alert;
}
