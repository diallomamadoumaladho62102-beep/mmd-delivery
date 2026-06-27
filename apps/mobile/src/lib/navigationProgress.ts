import type { CoordinatePoint } from "./coordinates";
import { distanceMeters } from "./coordinates";
import {
  forwardBearingFromAnchor,
  pointAtRouteDistance,
} from "./driverNavigationRouteStyle";

export type RouteProgress = {
  remainingMeters: number;
  traveledMeters: number;
  progressRatio: number;
  closestIndex: number;
  /** Point sur la LineString Mapbox — ancrage véhicule / routes / caméra. */
  anchorPoint: CoordinatePoint;
  /** Cap route devant l'ancre (polyline Mapbox). */
  forwardBearing: number;
};

function toRad(value: number): number {
  return (value * Math.PI) / 180;
}

function projectPointOnSegment(
  point: CoordinatePoint,
  start: CoordinatePoint,
  end: CoordinatePoint,
): { point: CoordinatePoint; t: number } {
  const latRad = toRad(start.latitude);
  const x1 = toRad(start.longitude) * Math.cos(latRad);
  const y1 = toRad(start.latitude);
  const x2 = toRad(end.longitude) * Math.cos(latRad);
  const y2 = toRad(end.latitude);
  const xp = toRad(point.longitude) * Math.cos(latRad);
  const yp = toRad(point.latitude);

  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return { point: start, t: 0 };
  }

  const t = Math.max(0, Math.min(1, ((xp - x1) * dx + (yp - y1) * dy) / lenSq));

  return {
    t,
    point: {
      latitude:
        start.latitude + t * (end.latitude - start.latitude),
      longitude:
        start.longitude + t * (end.longitude - start.longitude),
    },
  };
}

export function getRouteProgress(
  current: CoordinatePoint,
  route: GeoJSON.Feature<GeoJSON.LineString> | null | undefined,
  options?: { minSegmentIndex?: number; maxLateralMeters?: number },
): RouteProgress | null {
  const coordinates = route?.geometry?.coordinates;
  if (!coordinates?.length) return null;

  const minSegmentIndex = Math.max(0, options?.minSegmentIndex ?? 0);
  const maxLateralMeters = options?.maxLateralMeters ?? 45;

  let closestIndex = minSegmentIndex;
  let minDistance = Infinity;
  let traveledMeters = 0;
  let anchorPoint: CoordinatePoint = current;

  for (let index = minSegmentIndex; index < coordinates.length - 1; index += 1) {
    const startLng = Number(coordinates[index][0]);
    const startLat = Number(coordinates[index][1]);
    const endLng = Number(coordinates[index + 1][0]);
    const endLat = Number(coordinates[index + 1][1]);

    if (
      !Number.isFinite(startLat) ||
      !Number.isFinite(startLng) ||
      !Number.isFinite(endLat) ||
      !Number.isFinite(endLng)
    ) {
      continue;
    }

    const start = { latitude: startLat, longitude: startLng };
    const end = { latitude: endLat, longitude: endLng };
    const projected = projectPointOnSegment(current, start, end);
    const dist = distanceMeters(
      current.latitude,
      current.longitude,
      projected.point.latitude,
      projected.point.longitude,
    );

    if (dist > maxLateralMeters && index > minSegmentIndex) {
      continue;
    }

    if (dist < minDistance) {
      minDistance = dist;
      closestIndex = index;
      anchorPoint = projected.point;

      traveledMeters = 0;
      for (let i = 0; i < index; i += 1) {
        traveledMeters += distanceMeters(
          Number(coordinates[i][1]),
          Number(coordinates[i][0]),
          Number(coordinates[i + 1][1]),
          Number(coordinates[i + 1][0]),
        );
      }

      traveledMeters += distanceMeters(
        start.latitude,
        start.longitude,
        projected.point.latitude,
        projected.point.longitude,
      );
    }
  }

  let totalMeters = 0;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    totalMeters += distanceMeters(
      Number(coordinates[index][1]),
      Number(coordinates[index][0]),
      Number(coordinates[index + 1][1]),
      Number(coordinates[index + 1][0]),
    );
  }

  const remainingMeters = Math.max(0, totalMeters - traveledMeters);
  const progressRatio =
    totalMeters > 0 ? Math.min(1, traveledMeters / totalMeters) : 0;

  return {
    remainingMeters,
    traveledMeters,
    progressRatio,
    closestIndex,
    anchorPoint,
    forwardBearing: forwardBearingFromAnchor(
      route as GeoJSON.Feature<GeoJSON.LineString>,
      anchorPoint,
      traveledMeters,
    ),
  };
}

/**
 * Snap GPS sur la polyline — progression monotone (jamais de saut arrière).
 * Reste sur le segment courant ou en aval pour éviter les sauts perpendiculaires.
 */
export function getMonotonicRouteProgress(
  current: CoordinatePoint,
  route: GeoJSON.Feature<GeoJSON.LineString> | null | undefined,
  previousTraveledMeters: number,
): RouteProgress | null {
  const previousLocated = pointAtRouteDistance(route, previousTraveledMeters);
  const minSegmentIndex = previousLocated?.segmentIndex ?? 0;

  const raw =
    previousTraveledMeters > 0
      ? getRouteProgress(current, route, {
          minSegmentIndex,
          maxLateralMeters: 40,
        })
      : getRouteProgress(current, route);
  if (!raw || !route) return null;

  let traveledMeters: number;
  if (raw.traveledMeters >= previousTraveledMeters - 6) {
    traveledMeters = Math.max(raw.traveledMeters, previousTraveledMeters);
  } else {
    traveledMeters = previousTraveledMeters;
  }

  const located = pointAtRouteDistance(route, traveledMeters);
  if (!located) return raw;

  if (located.segmentIndex < minSegmentIndex) {
    traveledMeters = previousTraveledMeters;
  }

  const finalLocated = pointAtRouteDistance(route, traveledMeters);
  if (!finalLocated) return raw;

  const totalMeters = raw.traveledMeters + raw.remainingMeters;
  const remainingMeters = Math.max(0, totalMeters - traveledMeters);
  const progressRatio =
    totalMeters > 0 ? Math.min(1, traveledMeters / totalMeters) : 0;

  return {
    remainingMeters,
    traveledMeters,
    progressRatio,
    closestIndex: finalLocated.segmentIndex,
    anchorPoint: finalLocated.point,
    forwardBearing: forwardBearingFromAnchor(
      route,
      finalLocated.point,
      traveledMeters,
    ),
  };
}

function normalizeBearing(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return ((value % 360) + 360) % 360;
}

/** Heading GPS natif Expo (>= 0) ou dérivé du déplacement. */
export function isGpsHeadingAvailable(heading: number): boolean {
  return Number.isFinite(heading) && heading >= 0;
}

function bearingBetween(start: CoordinatePoint, end: CoordinatePoint): number {
  const dLon = ((end.longitude - start.longitude) * Math.PI) / 180;
  const lat1 = (start.latitude * Math.PI) / 180;
  const lat2 = (end.latitude * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return normalizeBearing((Math.atan2(y, x) * 180) / Math.PI);
}

/** Cap route devant le véhicule (degrés, 0 = nord). */
export function getRouteBearing(
  route: GeoJSON.Feature<GeoJSON.LineString> | null | undefined,
  closestIndex: number,
): number | null {
  const coordinates = route?.geometry?.coordinates;
  if (!coordinates || coordinates.length < 2) return null;

  const index = Math.min(Math.max(closestIndex, 0), coordinates.length - 2);
  const startLng = Number(coordinates[index][0]);
  const startLat = Number(coordinates[index][1]);
  const endLng = Number(coordinates[index + 1][0]);
  const endLat = Number(coordinates[index + 1][1]);

  if (
    !Number.isFinite(startLat) ||
    !Number.isFinite(startLng) ||
    !Number.isFinite(endLat) ||
    !Number.isFinite(endLng)
  ) {
    return null;
  }

  const dLon = ((endLng - startLng) * Math.PI) / 180;
  const lat1 = (startLat * Math.PI) / 180;
  const lat2 = (endLat * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Cap depuis l'ancre snapée vers le prochain sommet route en avant. */
export function getBearingFromAnchorToNextRoutePoint(
  route: GeoJSON.Feature<GeoJSON.LineString> | null | undefined,
  anchor: CoordinatePoint,
  closestIndex: number,
): number | null {
  const coordinates = route?.geometry?.coordinates;
  if (!coordinates || coordinates.length < 2) return null;

  const index = Math.min(Math.max(closestIndex, 0), coordinates.length - 2);
  const end = {
    latitude: Number(coordinates[index + 1][1]),
    longitude: Number(coordinates[index + 1][0]),
  };

  if (!Number.isFinite(end.latitude) || !Number.isFinite(end.longitude)) {
    return null;
  }

  const dist = distanceMeters(
    anchor.latitude,
    anchor.longitude,
    end.latitude,
    end.longitude,
  );
  if (dist < 0.25) {
    if (index + 2 >= coordinates.length) return null;
    const further = {
      latitude: Number(coordinates[index + 2][1]),
      longitude: Number(coordinates[index + 2][0]),
    };
    if (!Number.isFinite(further.latitude) || !Number.isFinite(further.longitude)) {
      return null;
    }
    return bearingBetween(anchor, further);
  }

  return bearingBetween(anchor, end);
}

/**
 * Cap navigation — route Mapbox devant l'ancre, puis GPS si cohérent.
 */
export function resolveDriverNavigationBearing(input: {
  gpsHeading: number;
  routeForwardBearing: number;
  route: GeoJSON.Feature<GeoJSON.LineString> | null | undefined;
  anchor: CoordinatePoint;
  closestIndex: number;
}): number {
  const routeCap = input.routeForwardBearing;

  if (isGpsHeadingAvailable(input.gpsHeading)) {
    const diff = Math.abs(
      ((input.gpsHeading - routeCap + 540) % 360) - 180,
    );
    if (diff < 40) {
      return normalizeBearing(input.gpsHeading * 0.55 + routeCap * 0.45);
    }
  }

  return normalizeBearing(routeCap);
}

/** Point sur la route à N mètres devant le véhicule (bulle rue). */
export function getRoutePointAhead(
  geometry: GeoJSON.Feature<GeoJSON.LineString> | null | undefined,
  origin: CoordinatePoint,
  aheadMeters: number,
): CoordinatePoint | null {
  const coordinates = geometry?.geometry?.coordinates;
  if (!coordinates || coordinates.length < 2) return null;

  const progress = getRouteProgress(origin, geometry);
  if (!progress) return null;

  const target = Math.max(40, aheadMeters);
  let walked = 0;
  const startIndex = Math.min(
    progress.closestIndex,
    coordinates.length - 2,
  );

  for (let index = startIndex; index < coordinates.length - 1; index += 1) {
    const startLat = Number(coordinates[index][1]);
    const startLng = Number(coordinates[index][0]);
    const endLat = Number(coordinates[index + 1][1]);
    const endLng = Number(coordinates[index + 1][0]);

    if (
      !Number.isFinite(startLat) ||
      !Number.isFinite(startLng) ||
      !Number.isFinite(endLat) ||
      !Number.isFinite(endLng)
    ) {
      continue;
    }

    const segLen = distanceMeters(startLat, startLng, endLat, endLng);
    if (walked + segLen >= target) {
      const t = segLen > 0 ? (target - walked) / segLen : 0;
      return {
        latitude: startLat + t * (endLat - startLat),
        longitude: startLng + t * (endLng - startLng),
      };
    }
    walked += segLen;
  }

  const last = coordinates[coordinates.length - 1];
  return {
    latitude: Number(last[1]),
    longitude: Number(last[0]),
  };
}

export function getSnappedRoutePoint(
  current: CoordinatePoint,
  route: GeoJSON.Feature<GeoJSON.LineString> | null | undefined,
): CoordinatePoint | null {
  const progress = getRouteProgress(current, route);
  return progress?.anchorPoint ?? null;
}

export function estimateRemainingMinutes(
  remainingMeters: number,
  routeDurationSeconds: number,
  routeDistanceMeters: number,
): number {
  if (!Number.isFinite(remainingMeters) || remainingMeters <= 0) return 0;

  if (
    Number.isFinite(routeDurationSeconds) &&
    Number.isFinite(routeDistanceMeters) &&
    routeDistanceMeters > 0
  ) {
    const speedMps = routeDistanceMeters / Math.max(routeDurationSeconds, 1);
    return Math.max(1, Math.round(remainingMeters / Math.max(speedMps, 1) / 60));
  }

  return Math.max(1, Math.round(remainingMeters / 1609.344 / 0.45));
}

export function distanceToRouteMeters(
  current: CoordinatePoint,
  route: GeoJSON.Feature<GeoJSON.LineString> | null | undefined,
): number {
  const progress = getRouteProgress(current, route);
  if (!progress) return Infinity;

  const coordinates = route?.geometry?.coordinates;
  if (!coordinates?.length) return Infinity;

  const index = progress.closestIndex;
  const startLng = Number(coordinates[index][0]);
  const startLat = Number(coordinates[index][1]);
  const endLng = Number(coordinates[index + 1]?.[0]);
  const endLat = Number(coordinates[index + 1]?.[1]);

  if (!Number.isFinite(startLat) || !Number.isFinite(startLng)) {
    return Infinity;
  }

  const start = { latitude: startLat, longitude: startLng };
  const end = Number.isFinite(endLat) && Number.isFinite(endLng)
    ? { latitude: endLat, longitude: endLng }
    : start;

  const projected = projectPointOnSegment(current, start, end);
  return distanceMeters(
    current.latitude,
    current.longitude,
    projected.point.latitude,
    projected.point.longitude,
  );
}
