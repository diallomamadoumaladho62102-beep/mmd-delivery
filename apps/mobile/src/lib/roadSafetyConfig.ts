/**
 * Client-side road-safety configuration resolution.
 *
 * The authoritative config lives in Supabase (`road_safety_country_config`) and
 * is returned by the `road-safety-events` Edge Function. This module provides
 * the type, safe defaults and a merge so the mobile app degrades gracefully
 * (and respects per-country legal gating) even if the backend is unreachable.
 */
import type { RoadSafetyEventType } from "./roadSafety";

export type RoadSafetyRuntimeConfig = {
  enableSpeedCamera: boolean;
  enableRedLightCamera: boolean;
  enableStopSign: boolean;
  enableSchoolZone: boolean;
  enableSpeedLimit: boolean;
  enableVoice: boolean;
  announceFarMeters: number;
  announceNearMeters: number;
  overspeedToleranceKmh: number;
  corridorRadiusMeters: number;
  minConfidence: number;
};

/**
 * Conservative defaults: cameras OFF (legally restricted in several countries),
 * stop/school/limit ON. The backend overrides these per country.
 */
export const DEFAULT_RUNTIME_CONFIG: RoadSafetyRuntimeConfig = {
  enableSpeedCamera: false,
  enableRedLightCamera: false,
  enableStopSign: true,
  enableSchoolZone: true,
  enableSpeedLimit: true,
  enableVoice: true,
  announceFarMeters: 500,
  announceNearMeters: 200,
  overspeedToleranceKmh: 10,
  corridorRadiusMeters: 25,
  minConfidence: 0.5,
};

type RawConfig = Partial<{
  enable_speed_camera: boolean;
  enable_red_light_camera: boolean;
  enable_stop_sign: boolean;
  enable_school_zone: boolean;
  enable_speed_limit: boolean;
  enable_voice: boolean;
  announce_far_meters: number;
  announce_near_meters: number;
  overspeed_tolerance_kmh: number;
  corridor_radius_meters: number;
  min_confidence: number;
}>;

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Merge a backend config row (snake_case) onto the safe defaults. */
export function resolveRuntimeConfig(raw: RawConfig | null | undefined): RoadSafetyRuntimeConfig {
  const d = DEFAULT_RUNTIME_CONFIG;
  if (!raw) return { ...d };
  return {
    enableSpeedCamera: bool(raw.enable_speed_camera, d.enableSpeedCamera),
    enableRedLightCamera: bool(raw.enable_red_light_camera, d.enableRedLightCamera),
    enableStopSign: bool(raw.enable_stop_sign, d.enableStopSign),
    enableSchoolZone: bool(raw.enable_school_zone, d.enableSchoolZone),
    enableSpeedLimit: bool(raw.enable_speed_limit, d.enableSpeedLimit),
    enableVoice: bool(raw.enable_voice, d.enableVoice),
    announceFarMeters: num(raw.announce_far_meters, d.announceFarMeters),
    announceNearMeters: num(raw.announce_near_meters, d.announceNearMeters),
    overspeedToleranceKmh: num(raw.overspeed_tolerance_kmh, d.overspeedToleranceKmh),
    corridorRadiusMeters: num(raw.corridor_radius_meters, d.corridorRadiusMeters),
    minConfidence: num(raw.min_confidence, d.minConfidence),
  };
}

/** Is a category allowed to be shown under the current config? */
export function isCategoryEnabled(
  config: RoadSafetyRuntimeConfig,
  type: RoadSafetyEventType,
): boolean {
  switch (type) {
    case "speed_camera":
      return config.enableSpeedCamera;
    case "red_light_camera":
      return config.enableRedLightCamera;
    case "stop_sign":
      return config.enableStopSign;
    case "school_zone":
      return config.enableSchoolZone;
    case "speed_limit":
      return config.enableSpeedLimit;
    default:
      return false;
  }
}
