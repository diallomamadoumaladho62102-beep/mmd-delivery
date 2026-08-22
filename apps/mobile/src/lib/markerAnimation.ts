import type { CoordinatePoint } from "./coordinates";
import { distanceMeters } from "./coordinates";

export function normalizeAngle(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  return ((degrees % 360) + 360) % 360;
}

/** Shortest signed delta from `fromDeg` to `toDeg` (e.g. 359 → 1 = +2). */
export function shortestAngleDelta(fromDeg: number, toDeg: number): number {
  const from = normalizeAngle(fromDeg);
  const to = normalizeAngle(toDeg);
  let delta = to - from;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

export function interpolateAngle(
  fromDeg: number,
  toDeg: number,
  progress: number,
): number {
  const t = clamp01(progress);
  return normalizeAngle(fromDeg + shortestAngleDelta(fromDeg, toDeg) * t);
}

export function interpolateCoordinate(
  from: CoordinatePoint,
  to: CoordinatePoint,
  progress: number,
): CoordinatePoint {
  const t = clamp01(progress);
  return {
    latitude: from.latitude + (to.latitude - from.latitude) * t,
    longitude: from.longitude + (to.longitude - from.longitude) * t,
  };
}

/**
 * Duration for marker glide between two GPS samples.
 * Uses reported speed when credible; never runs faster than the implied GPS rate.
 */
export function estimateMarkerAnimationDurationMs(params: {
  from: CoordinatePoint;
  to: CoordinatePoint;
  speedMps?: number | null;
  sampleAgeMs?: number;
}): number {
  const dist = distanceMeters(
    params.from.latitude,
    params.from.longitude,
    params.to.latitude,
    params.to.longitude,
  );

  if (dist < 0.5) return 0;

  const speed =
    params.speedMps != null && Number.isFinite(params.speedMps) && params.speedMps > 0.5
      ? params.speedMps
      : null;

  let durationMs = speed ? (dist / speed) * 1000 : dist * 90;
  if (params.sampleAgeMs != null && Number.isFinite(params.sampleAgeMs)) {
    durationMs = Math.max(durationMs, params.sampleAgeMs * 0.85);
  }

  return Math.min(8000, Math.max(350, durationMs));
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}
