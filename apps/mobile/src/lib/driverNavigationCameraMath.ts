import { NAV_CAMERA } from "./driverNavigationVisual";
import type { CoordinatePoint } from "./coordinates";

export type AdaptiveCameraSettings = {
  zoom: number;
  pitch: number;
  paddingTop: number;
  paddingBottom: number;
};

/** Déplace un point le long d'un cap (mètres). */
export function pointOffsetByBearing(
  point: CoordinatePoint,
  bearingDegrees: number,
  distanceMeters: number,
): CoordinatePoint {
  const earthRadius = 6371000;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const lat1 = (point.latitude * Math.PI) / 180;
  const lon1 = (point.longitude * Math.PI) / 180;
  const angular = distanceMeters / earthRadius;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    latitude: (lat2 * 180) / Math.PI,
    longitude: (lon2 * 180) / Math.PI,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Caméra dynamique — zoom léger aux virages, pitch toujours bas (pas de ciel).
 */
export function computeAdaptiveCameraSettings(params: {
  maneuverDistanceMeters: number | null;
  speedMps: number | null;
  paddingTop: number;
  paddingBottom: number;
}): AdaptiveCameraSettings {
  const { maneuverDistanceMeters, speedMps, paddingTop, paddingBottom } = params;

  let zoom = NAV_CAMERA.zoom;
  let pitch = NAV_CAMERA.pitch;

  if (maneuverDistanceMeters != null && Number.isFinite(maneuverDistanceMeters)) {
    if (maneuverDistanceMeters < 45) {
      zoom = NAV_CAMERA.zoomTurnTight;
      pitch = NAV_CAMERA.pitchTurn;
    } else if (maneuverDistanceMeters < 120) {
      const t = (maneuverDistanceMeters - 45) / 75;
      zoom =
        NAV_CAMERA.zoomTurnTight +
        t * (NAV_CAMERA.zoomTurnApproach - NAV_CAMERA.zoomTurnTight);
      pitch =
        NAV_CAMERA.pitchTurn +
        t * (NAV_CAMERA.pitchTurnApproach - NAV_CAMERA.pitchTurn);
    } else if (maneuverDistanceMeters < 280) {
      const t = (maneuverDistanceMeters - 120) / 160;
      zoom =
        NAV_CAMERA.zoomTurnApproach +
        t * (NAV_CAMERA.zoom - NAV_CAMERA.zoomTurnApproach);
      pitch =
        NAV_CAMERA.pitchTurnApproach +
        t * (NAV_CAMERA.pitch - NAV_CAMERA.pitchTurnApproach);
    } else if (maneuverDistanceMeters > 550) {
      zoom = NAV_CAMERA.zoomOpenRoad;
      pitch = NAV_CAMERA.pitchOpenRoad;
    }
  }

  if (speedMps != null && Number.isFinite(speedMps)) {
    if (speedMps < 4) {
      zoom += 0.2;
    } else if (speedMps < 12) {
      zoom += 0.08;
    } else if (speedMps > 30) {
      zoom -= 0.28;
    } else if (speedMps > 22) {
      zoom -= 0.15;
    }
  }

  zoom = clamp(zoom, NAV_CAMERA.zoomMin, NAV_CAMERA.zoomMax);
  pitch = clamp(pitch, NAV_CAMERA.pitchMin, NAV_CAMERA.pitchMax);

  return {
    zoom,
    pitch,
    paddingTop,
    paddingBottom,
  };
}
