/**
 * Mapbox Directions lane guidance helpers.
 * Lanes come from `step.intersections[].lanes` on the approach to a maneuver.
 */

export type NavigationLane = {
  /** True when this lane is valid for the upcoming maneuver. */
  valid: boolean;
  /** Mapbox indication tokens (left, straight, right, …). */
  indications: string[];
};

export function parseMapboxLanes(rawIntersections: unknown): NavigationLane[] | undefined {
  if (!Array.isArray(rawIntersections) || rawIntersections.length === 0) {
    return undefined;
  }

  // Prefer the last intersection that actually carries lane data (closest to maneuver).
  for (let i = rawIntersections.length - 1; i >= 0; i -= 1) {
    const entry = rawIntersections[i] as { lanes?: unknown };
    if (!Array.isArray(entry?.lanes) || entry.lanes.length === 0) continue;

    const lanes: NavigationLane[] = [];
    for (const laneRaw of entry.lanes) {
      if (!laneRaw || typeof laneRaw !== "object") continue;
      const lane = laneRaw as { valid?: unknown; indications?: unknown };
      const indications = Array.isArray(lane.indications)
        ? lane.indications
            .map((token) => String(token ?? "").trim().toLowerCase())
            .filter(Boolean)
        : [];
      lanes.push({
        valid: lane.valid === true,
        indications,
      });
    }

    if (lanes.length > 0) return lanes;
  }

  return undefined;
}

/** Compact arrow glyph for a lane indication set. */
export function laneIndicationGlyph(indications: string[]): string {
  const set = new Set(indications);
  if (set.has("uturn") || set.has("uturn left") || set.has("uturn right")) return "↩";
  if (set.has("sharp left") || set.has("left")) return "↰";
  if (set.has("slight left")) return "↖";
  if (set.has("sharp right") || set.has("right")) return "↱";
  if (set.has("slight right")) return "↗";
  if (set.has("straight")) return "↑";
  if (indications[0]) {
    if (indications[0].includes("left")) return "↰";
    if (indications[0].includes("right")) return "↱";
  }
  return "↑";
}

/** Show lane guidance in HUD when approaching a maneuver (within 250 m). */
export function shouldShowLaneGuidance(
  lanes: NavigationLane[] | null | undefined,
  distanceToManeuverMeters: number | null | undefined,
): boolean {
  if (!lanes || lanes.length < 2) return false;
  if (distanceToManeuverMeters == null || !Number.isFinite(distanceToManeuverMeters)) {
    return false;
  }
  return distanceToManeuverMeters > 15 && distanceToManeuverMeters <= 250;
}
