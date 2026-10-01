import type { GpsPoint } from "./types";

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function isFiniteCoord(lat: unknown, lng: unknown): boolean {
  const a = Number(lat);
  const b = Number(lng);
  return (
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    a >= -90 &&
    a <= 90 &&
    b >= -180 &&
    b <= 180
  );
}

export function haversineMeters(
  a: Pick<GpsPoint, "lat" | "lng">,
  b: Pick<GpsPoint, "lat" | "lng">
): number | null {
  if (!isFiniteCoord(a.lat, a.lng) || !isFiniteCoord(b.lat, b.lng)) return null;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function speedMetersPerSecond(
  from: GpsPoint,
  to: GpsPoint
): number | null {
  const meters = haversineMeters(from, to);
  const dt = (to.atMs - from.atMs) / 1000;
  if (meters == null || !Number.isFinite(dt) || dt <= 0) return null;
  return meters / dt;
}

export function gpsIsIntegritySignalOnly(): true {
  return true;
}

export function gpsAbsenceIsNotFraud(gpsAvailable: boolean): boolean {
  return gpsAvailable === false;
}
