import type { NavigationRouteStep } from "./navigationService";

/** Small deterministic hash — stable across runs for the same input string. */
export function hashNavigationSignature(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (Math.imul(31, hash) + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * Stable route identity for voice + maneuver memory.
 * Depends on maneuver semantics and route endpoints — NOT coordinate count
 * (which can change on minor geometry refreshes while the route is unchanged).
 */
export function buildStableRouteVersion(params: {
  selectedRouteIndex: number;
  steps?: NavigationRouteStep[];
  coordinates?: number[][];
}): string {
  const steps = params.steps ?? [];
  const stepSig = steps
    .map(
      (step, index) =>
        `${index}:${step.maneuverType ?? ""}:${step.maneuverModifier ?? ""}:${(step.instruction ?? "").trim().slice(0, 96)}`,
    )
    .join("|");

  const coords = params.coordinates ?? [];
  const start = coords[0];
  const end = coords[coords.length - 1];
  const geoSig =
    start && end
      ? `${roundCoord(start[0])},${roundCoord(start[1])}->${roundCoord(end[0])},${roundCoord(end[1])}`
      : "no-geo";

  return `${params.selectedRouteIndex}:${steps.length}:${geoSig}:${hashNavigationSignature(stepSig)}`;
}

function roundCoord(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "?";
  return value.toFixed(5);
}
