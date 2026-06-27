import { useEffect, useMemo, useState } from "react";
import * as Location from "expo-location";
import type { DriverMapLocationState } from "./useDriverMapLocation";
import { getPreviewPointAlongRoute } from "../lib/driverNavigationPreview";

export function useDriverNavigationPreviewLocation(
  enabled: boolean,
  routeGeometry: GeoJSON.Feature<GeoJSON.LineString> | null | undefined,
  fixedProgress?: number | null,
): DriverMapLocationState {
  const [progress, setProgress] = useState(fixedProgress ?? 0.12);

  useEffect(() => {
    if (fixedProgress != null) {
      setProgress(fixedProgress);
    }
  }, [fixedProgress]);

  useEffect(() => {
    if (!enabled || !routeGeometry?.geometry?.coordinates?.length) return;
    if (fixedProgress != null) return;

    const timer = setInterval(() => {
      setProgress((value) => Math.min(0.78, value + 0.018));
    }, 2800);

    return () => clearInterval(timer);
  }, [enabled, fixedProgress, routeGeometry]);

  const frame = useMemo(
    () => getPreviewPointAlongRoute(routeGeometry, progress),
    [progress, routeGeometry],
  );

  if (!enabled) {
    return {
      point: null,
      heading: 0,
      accuracyMeters: null,
      speedMps: null,
      gpsStatus: "initializing",
      permissionStatus: "undetermined",
      lastUpdatedAt: null,
      errorMessage: null,
      isReady: false,
    };
  }

  return {
    point: frame.point,
    heading: frame.heading,
    accuracyMeters: 8,
    speedMps: frame.speedMps,
    gpsStatus: "active",
    permissionStatus: Location.PermissionStatus.GRANTED,
    lastUpdatedAt: Date.now(),
    errorMessage: null,
    isReady: true,
  };
}
