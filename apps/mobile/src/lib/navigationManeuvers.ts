/**
 * Pure turn-by-turn maneuver engine.
 *
 * The active maneuver is derived from the driver's *traveled distance along the
 * route* (progression réelle sur la géométrie), never from a static index and
 * never defaulting to `steps[steps.length - 1]`. This keeps the on-screen
 * instruction and the spoken instruction pointing at the same real maneuver.
 */
import type { CoordinatePoint } from "./coordinates";
import type { NavigationRouteStep } from "./navigationService";
import type { NavigationLane } from "./navigationLanes";
import {
  formatManeuverDistanceLabel,
  resolveNavigationLocale,
  type NavigationLocale,
} from "./navigationLocale";

export type ManeuverKind =
  | "turn-left"
  | "turn-right"
  | "slight-left"
  | "slight-right"
  | "sharp-left"
  | "sharp-right"
  | "straight"
  | "uturn"
  | "roundabout"
  | "fork-left"
  | "fork-right"
  | "merge"
  | "exit"
  | "depart"
  | "arrive"
  | "continue";

export type RouteManeuver = {
  /** Stable id within a route version (`${routeVersion}:${index}`). */
  id: string;
  index: number;
  /** Distance (m) from route start to the maneuver point. */
  alongRouteMeters: number;
  kind: ManeuverKind;
  rawInstruction: string;
  streetName: string;
  point: CoordinatePoint | null;
  isArrival: boolean;
  lanes?: NavigationLane[];
};

export type ActiveManeuverSelection = {
  active: RouteManeuver;
  /** Live distance (m) from the driver to the active maneuver. */
  distanceMeters: number;
  secondary: RouteManeuver | null;
  secondaryDistanceMeters: number | null;
};

/** Small hysteresis so GPS jitter never drops a maneuver before it is passed. */
const PASSED_TOLERANCE_METERS = 22;

function normalizeKind(step: NavigationRouteStep): ManeuverKind {
  const type = (step.maneuverType ?? "").toLowerCase();
  const modifier = (step.maneuverModifier ?? "").toLowerCase();

  if (type === "arrive") return "arrive";
  if (type === "depart") return "depart";
  if (type.includes("roundabout") || type.includes("rotary")) return "roundabout";
  if (type === "merge") return "merge";
  if (type.includes("exit") || type === "off ramp" || type === "on ramp") {
    return "exit";
  }
  if (type === "fork") {
    return modifier.includes("left") ? "fork-left" : "fork-right";
  }

  if (modifier.includes("uturn") || modifier.includes("u-turn")) return "uturn";
  if (modifier === "straight") return "straight";
  if (modifier === "slight left") return "slight-left";
  if (modifier === "slight right") return "slight-right";
  if (modifier === "sharp left") return "sharp-left";
  if (modifier === "sharp right") return "sharp-right";
  if (modifier === "left") return "turn-left";
  if (modifier === "right") return "turn-right";

  if (type === "continue" || type === "new name") return "continue";

  // Fallback: infer from instruction text without trusting a single language.
  const text = step.instruction.toLowerCase();
  if (/\b(u-turn|demi-tour|media vuelta)\b/.test(text)) return "uturn";
  if (/\b(left|gauche|izquierda)\b/.test(text)) return "turn-left";
  if (/\b(right|droite|derecha)\b/.test(text)) return "turn-right";
  return "continue";
}

function fallbackStreetName(instruction: string): string {
  const trimmed = instruction.trim();
  const patterns = [
    /\bsur\s+(.+)$/i,
    /\bonto\s+(.+)$/i,
    /\bon\s+(.+)$/i,
    /\bvers\s+(.+)$/i,
    /\btoward\s+(.+)$/i,
    /\bhacia\s+(.+)$/i,
    /\bpor\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return match[1].trim().replace(/[.,]$/, "");
  }
  return trimmed;
}

/**
 * Build the ordered maneuver list for a route. The `depart` step (index 0) is
 * kept for positioning but is never treated as an upcoming maneuver.
 */
export function buildManeuverList(
  steps: NavigationRouteStep[] | undefined,
  routeVersion: string,
): RouteManeuver[] {
  if (!steps?.length) return [];

  let cumulative = 0;
  return steps.map((step, index) => {
    const along = step.maneuverAlongRouteMeters ?? cumulative;
    cumulative = along + (step.distanceMeters ?? 0);
    const kind = normalizeKind(step);
    return {
      id: `${routeVersion}:${index}`,
      index,
      alongRouteMeters: along,
      kind,
      rawInstruction: step.instruction,
      streetName: (step.roadName?.trim() || fallbackStreetName(step.instruction)).trim(),
      point: step.maneuverPoint ?? null,
      isArrival: kind === "arrive",
      lanes: step.lanes,
    };
  });
}

/**
 * Select the next *real* maneuver ahead of the driver from traveled distance.
 *
 * - Skips the `depart` maneuver.
 * - Keeps the current maneuver active until it is actually passed
 *   (`traveled > along + tolerance`), so two close turns are handled in order.
 * - Only surfaces `arrive` once every intermediate maneuver is behind.
 */
export function selectActiveManeuver(
  maneuvers: RouteManeuver[],
  traveledMeters: number,
  options?: { passedToleranceMeters?: number },
): ActiveManeuverSelection | null {
  if (!maneuvers.length) return null;

  const tolerance = options?.passedToleranceMeters ?? PASSED_TOLERANCE_METERS;
  const upcoming = maneuvers.filter((m) => m.kind !== "depart");
  if (!upcoming.length) return null;

  let active: RouteManeuver | null = null;
  for (const maneuver of upcoming) {
    // A maneuver stays eligible until the driver clearly passes it.
    if (maneuver.alongRouteMeters > traveledMeters - tolerance) {
      active = maneuver;
      break;
    }
  }

  // Past the last intermediate maneuver → the arrival maneuver is next.
  if (!active) {
    active = upcoming[upcoming.length - 1] ?? null;
  }
  if (!active) return null;

  const activePos = upcoming.indexOf(active);
  const secondary = activePos >= 0 ? upcoming[activePos + 1] ?? null : null;

  const distanceMeters = Math.max(0, active.alongRouteMeters - traveledMeters);
  const secondaryDistanceMeters = secondary
    ? Math.max(0, secondary.alongRouteMeters - traveledMeters)
    : null;

  return { active, distanceMeters, secondary, secondaryDistanceMeters };
}

const VERB: Record<
  ManeuverKind,
  Record<NavigationLocale, string>
> = {
  "turn-left": { en: "turn left", fr: "tournez à gauche", es: "gire a la izquierda" },
  "turn-right": { en: "turn right", fr: "tournez à droite", es: "gire a la derecha" },
  "slight-left": { en: "keep left", fr: "serrez à gauche", es: "manténgase a la izquierda" },
  "slight-right": { en: "keep right", fr: "serrez à droite", es: "manténgase a la derecha" },
  "sharp-left": { en: "turn sharp left", fr: "tournez fortement à gauche", es: "gire cerrado a la izquierda" },
  "sharp-right": { en: "turn sharp right", fr: "tournez fortement à droite", es: "gire cerrado a la derecha" },
  straight: { en: "continue straight", fr: "continuez tout droit", es: "continúe recto" },
  uturn: { en: "make a U-turn", fr: "faites demi-tour", es: "haga un cambio de sentido" },
  roundabout: { en: "take the roundabout", fr: "prenez le rond-point", es: "tome la rotonda" },
  "fork-left": { en: "keep left at the fork", fr: "au embranchement, restez à gauche", es: "en la bifurcación, manténgase a la izquierda" },
  "fork-right": { en: "keep right at the fork", fr: "au embranchement, restez à droite", es: "en la bifurcación, manténgase a la derecha" },
  merge: { en: "merge", fr: "insérez-vous", es: "incorpórese" },
  exit: { en: "take the exit", fr: "prenez la sortie", es: "tome la salida" },
  depart: { en: "start", fr: "démarrez", es: "comience" },
  arrive: { en: "arrive at your destination", fr: "vous êtes arrivé à destination", es: "ha llegado a su destino" },
  continue: { en: "continue", fr: "continuez", es: "continúe" },
};

const ON_STREET: Record<NavigationLocale, string> = {
  en: "onto",
  fr: "sur",
  es: "por",
};

/** Localized distance prefix ("In 500 m", "Dans 500 mètres"). */
export function formatVoiceDistancePrefix(
  meters: number,
  locale: NavigationLocale,
): string {
  const rounded = Math.max(0, Math.round(meters / 10) * 10);
  if (locale === "fr") return `Dans ${rounded} mètres`;
  if (locale === "es") return `En ${rounded} metros`;
  return formatManeuverDistanceLabel(meters, locale);
}

/**
 * Build the spoken phrase for a maneuver. `distanceMeters === null` means an
 * immediate ("now") announcement without a distance prefix.
 */
export function formatManeuverVoice(params: {
  maneuver: Pick<RouteManeuver, "kind" | "streetName">;
  distanceMeters: number | null;
  locale: string | NavigationLocale;
}): string {
  const locale =
    typeof params.locale === "string"
      ? resolveNavigationLocale(params.locale)
      : params.locale;
  const { maneuver } = params;
  const verb = VERB[maneuver.kind][locale];

  if (maneuver.kind === "arrive") {
    return VERB.arrive[locale].replace(/^./, (c) => c.toUpperCase());
  }

  const withStreet =
    maneuver.streetName &&
    !maneuver.streetName.toLowerCase().includes(verb.toLowerCase()) &&
    maneuver.kind !== "roundabout" &&
    maneuver.kind !== "uturn" &&
    maneuver.kind !== "straight"
      ? `${verb} ${ON_STREET[locale]} ${maneuver.streetName}`
      : verb;

  if (params.distanceMeters == null) {
    const now = locale === "fr" ? "Maintenant, " : locale === "es" ? "Ahora, " : "Now, ";
    return `${now}${withStreet}`.replace(/\s+/g, " ").trim();
  }

  const prefix = formatVoiceDistancePrefix(params.distanceMeters, locale);
  return `${prefix}, ${withStreet}`.replace(/\s+/g, " ").trim();
}
