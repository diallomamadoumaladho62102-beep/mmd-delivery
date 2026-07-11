/**
 * Pure validators + legal gating shared by the road-safety Edge Functions.
 * No Deno/runtime APIs → unit-testable from the mobile tsx harness.
 */

export type Bbox = { south: number; west: number; north: number; east: number };

export type CountryConfigRow = {
  enable_speed_camera?: boolean;
  enable_red_light_camera?: boolean;
  enable_stop_sign?: boolean;
  enable_school_zone?: boolean;
  enable_speed_limit?: boolean;
  min_confidence?: number;
  legal_status?: "allowed" | "restricted" | "unknown" | "disabled";
};

export type BboxValidation = { ok: true } | { ok: false; reason: string };

/** Validate a query bbox: finite, ordered, and not larger than `maxDeg`. */
export function validateBbox(b: unknown, maxDeg = 2): BboxValidation {
  const box = b as Partial<Bbox> | null | undefined;
  if (!box) return { ok: false, reason: "missing_bbox" };
  const { south, west, north, east } = box;
  if (![south, west, north, east].every((v) => typeof v === "number" && Number.isFinite(v))) {
    return { ok: false, reason: "non_numeric" };
  }
  if ((south as number) < -90 || (north as number) > 90) return { ok: false, reason: "lat_range" };
  if ((west as number) < -180 || (east as number) > 180) return { ok: false, reason: "lng_range" };
  if ((south as number) >= (north as number) || (west as number) >= (east as number)) {
    return { ok: false, reason: "unordered" };
  }
  if ((north as number) - (south as number) > maxDeg || (east as number) - (west as number) > maxDeg) {
    return { ok: false, reason: "too_large" };
  }
  return { ok: true };
}

/** Camera categories are the only legally-gated ones. */
export function isCameraCategory(type: string): boolean {
  return type === "speed_camera" || type === "red_light_camera";
}

/**
 * Resolve which event types may be surfaced, applying legal gating: camera
 * categories require legal_status === 'allowed'. 'unknown'/'restricted'/
 * 'disabled' never surface camera alerts even if the enable flag is on.
 */
export function resolveEnabledTypes(config: CountryConfigRow | null | undefined): string[] {
  const c = config ?? {};
  const cameraAllowed = c.legal_status === "allowed";
  const types: string[] = [];
  if (c.enable_speed_camera && cameraAllowed) types.push("speed_camera");
  if (c.enable_red_light_camera && cameraAllowed) types.push("red_light_camera");
  if (c.enable_stop_sign !== false) types.push("stop_sign");
  if (c.enable_school_zone !== false) types.push("school_zone");
  if (c.enable_speed_limit !== false) types.push("speed_limit");
  return types;
}
