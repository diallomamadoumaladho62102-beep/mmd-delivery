import { useMemo } from "react";
import type { CoordinatePoint } from "../lib/coordinates";
import { getSnappedRoutePoint } from "../lib/navigationProgress";

export function useSnappedRoutePoint(
  point: CoordinatePoint | null,
  route: GeoJSON.Feature<GeoJSON.LineString> | null | undefined,
): CoordinatePoint | null {
  return useMemo(() => {
    if (!point || !route?.geometry) return point;
    return getSnappedRoutePoint(point, route) ?? point;
  }, [point?.latitude, point?.longitude, route]);
}
