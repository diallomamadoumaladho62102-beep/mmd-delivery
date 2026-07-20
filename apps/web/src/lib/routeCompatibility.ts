/**
 * Pure route-compatibility checks for stacked Food/Delivery/Package missions.
 * Used by dispatch before creating offers; mirrored by SQL capacity locks on accept.
 */

export type LatLng = { lat: number; lng: number };

export type RouteCompatibilitySettings = {
  route_compatibility_enabled: boolean;
  max_route_detour_miles: number;
  max_route_detour_minutes: number;
  max_added_eta_minutes: number;
  /** Prefer refusing missions that delay hot food beyond this added ETA. */
  food_hot_priority_enabled: boolean;
};

export const DEFAULT_ROUTE_COMPATIBILITY: RouteCompatibilitySettings = {
  route_compatibility_enabled: true,
  max_route_detour_miles: 5,
  max_route_detour_minutes: 15,
  max_added_eta_minutes: 20,
  food_hot_priority_enabled: true,
};

export function milesBetween(a: LatLng, b: LatLng): number {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sin =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(sin), Math.sqrt(1 - sin));
}

/** Bearing degrees 0–360 from a → b. */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

export function angleDeltaDegrees(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export type ActiveMissionRoute = {
  pickup: LatLng | null;
  dropoff: LatLng | null;
  /** Approximate remaining ETA minutes for this mission (optional). */
  remainingEtaMinutes?: number | null;
  kind?: "food" | "package" | "delivery" | string;
};

export type RouteCompatibilityInput = {
  driverLocation: LatLng | null;
  activeMissions: ActiveMissionRoute[];
  newPickup: LatLng;
  newDropoff: LatLng | null;
  newKind?: "food" | "package" | "delivery" | string;
  settings?: Partial<RouteCompatibilitySettings>;
  /** Assumed minutes per mile for detour ETA estimate. */
  minutesPerMile?: number;
};

export type RouteCompatibilityResult = {
  ok: boolean;
  reason?: string;
  detourMiles?: number;
  detourMinutes?: number;
  directionDeltaDegrees?: number;
  stackIndex?: number;
};

/**
 * A new mission is compatible when it continues roughly in the same travel
 * direction and does not add an excessive detour vs continuing current dropoffs.
 * Proximity alone (e.g. within 15 mi) is NOT sufficient.
 */
export function evaluateRouteCompatibility(
  input: RouteCompatibilityInput,
): RouteCompatibilityResult {
  const settings: RouteCompatibilitySettings = {
    ...DEFAULT_ROUTE_COMPATIBILITY,
    ...(input.settings ?? {}),
  };
  const minutesPerMile = input.minutesPerMile ?? 2.5;
  const stackIndex = input.activeMissions.length + 1;

  if (!settings.route_compatibility_enabled) {
    return { ok: true, stackIndex };
  }

  if (input.activeMissions.length === 0) {
    return { ok: true, stackIndex: 1 };
  }

  const anchorDropoffs = input.activeMissions
    .map((m) => m.dropoff)
    .filter((d): d is LatLng => !!d && Number.isFinite(d.lat) && Number.isFinite(d.lng));

  const origin =
    input.driverLocation ??
    input.activeMissions.find((m) => m.pickup)?.pickup ??
    null;

  if (!origin || anchorDropoffs.length === 0) {
    // Without geometry, refuse stacking rather than blindly accepting radius matches.
    return { ok: false, reason: "missing_route_geometry", stackIndex };
  }

  // Current route heading: driver/origin → farthest / last dropoff centroid
  const dropCentroid: LatLng = {
    lat: anchorDropoffs.reduce((s, d) => s + d.lat, 0) / anchorDropoffs.length,
    lng: anchorDropoffs.reduce((s, d) => s + d.lng, 0) / anchorDropoffs.length,
  };
  const currentBearing = bearingDegrees(origin, dropCentroid);
  const newBearing = bearingDegrees(origin, input.newPickup);
  const directionDelta = angleDeltaDegrees(currentBearing, newBearing);

  // Opposite direction (~> 90°) is a hard refuse
  if (directionDelta > 90) {
    return {
      ok: false,
      reason: "opposite_direction",
      directionDeltaDegrees: directionDelta,
      stackIndex,
    };
  }

  // Detour: extra miles vs going straight to current dropoffs then new pickup
  const directToDrop = milesBetween(origin, dropCentroid);
  const viaNew =
    milesBetween(origin, input.newPickup) +
    (input.newDropoff
      ? milesBetween(input.newPickup, input.newDropoff) +
        milesBetween(input.newDropoff, dropCentroid)
      : milesBetween(input.newPickup, dropCentroid));
  const detourMiles = Math.max(0, viaNew - directToDrop);
  const detourMinutes = detourMiles * minutesPerMile;

  if (detourMiles > settings.max_route_detour_miles) {
    return {
      ok: false,
      reason: "detour_miles_exceeded",
      detourMiles,
      detourMinutes,
      directionDeltaDegrees: directionDelta,
      stackIndex,
    };
  }

  if (detourMinutes > settings.max_route_detour_minutes) {
    return {
      ok: false,
      reason: "detour_minutes_exceeded",
      detourMiles,
      detourMinutes,
      directionDeltaDegrees: directionDelta,
      stackIndex,
    };
  }

  const existingEta = input.activeMissions.reduce(
    (s, m) => s + (Number(m.remainingEtaMinutes) || 0),
    0,
  );
  const addedEta = detourMinutes;
  if (addedEta > settings.max_added_eta_minutes) {
    return {
      ok: false,
      reason: "added_eta_exceeded",
      detourMiles,
      detourMinutes: addedEta,
      directionDeltaDegrees: directionDelta,
      stackIndex,
    };
  }

  const hasHotFood = input.activeMissions.some((m) => m.kind === "food");
  if (
    settings.food_hot_priority_enabled &&
    hasHotFood &&
    addedEta > Math.min(10, settings.max_added_eta_minutes)
  ) {
    return {
      ok: false,
      reason: "food_hot_delay_protected",
      detourMiles,
      detourMinutes: addedEta,
      directionDeltaDegrees: directionDelta,
      stackIndex,
    };
  }

  // Mild soft check: don't delay existing customers excessively
  if (existingEta > 0 && addedEta > existingEta * 0.5 && addedEta > 8) {
    return {
      ok: false,
      reason: "excessive_existing_customer_delay",
      detourMiles,
      detourMinutes: addedEta,
      directionDeltaDegrees: directionDelta,
      stackIndex,
    };
  }

  return {
    ok: true,
    detourMiles,
    detourMinutes,
    directionDeltaDegrees: directionDelta,
    stackIndex,
  };
}

export function formatStackedDeliveryLabel(
  stackIndex: number,
  maxMissions: number,
): string {
  return `Stacked delivery ${stackIndex} of ${maxMissions}`;
}
