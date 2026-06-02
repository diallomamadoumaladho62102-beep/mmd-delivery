import type { CoordinatePoint } from "./coordinates";
import { distanceMeters } from "./coordinates";

export type RouteProgress = {
  remainingMeters: number;
  traveledMeters: number;
  progressRatio: number;
  closestIndex: number;
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
): RouteProgress | null {
  const coordinates = route?.geometry?.coordinates;
  if (!coordinates?.length) return null;

  let closestIndex = 0;
  let minDistance = Infinity;
  let traveledMeters = 0;

  for (let index = 0; index < coordinates.length - 1; index += 1) {
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

    if (dist < minDistance) {
      minDistance = dist;
      closestIndex = index;

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
  };
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
