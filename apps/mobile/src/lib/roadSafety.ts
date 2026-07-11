/**
 * Road-safety alert engine (speed cameras, red-light cameras, speed limits,
 * stop signs, school zones).
 *
 * DATA HONESTY — this module never fabricates safety data. It only projects and
 * announces events supplied by a real, authorized source (see
 * `RoadSafetyProvider`). The Mapbox Directions `driving` profile does NOT
 * expose cameras / stop signs / school zones; only `maxspeed` (speed limits)
 * is available and is handled by `navigationSpeedLimit.ts`. Until an authorized
 * provider or backend feed is wired, `getRoadSafetyEvents()` returns `[]`.
 */
import type { CoordinatePoint } from "./coordinates";
import { distanceMeters } from "./coordinates";
import { resolveNavigationLocale, type NavigationLocale } from "./navigationLocale";
import { VoicePriority, type VoiceAnnouncement } from "./navigationVoiceTriggers";

export type RoadSafetyEventType =
  | "speed_camera"
  | "red_light_camera"
  | "speed_limit"
  | "stop_sign"
  | "school_zone";

export type RoadSafetyDirection = "forward" | "backward" | "both" | "unknown";

/** A raw safety event as provided by a source (backend / OSM / provider). */
export type RoadSafetyEvent = {
  /** Stable id from the source — used for announce-once memory. */
  id: string;
  type: RoadSafetyEventType;
  coordinate: CoordinatePoint;
  /** Provider/source name, for auditing (never fabricate). */
  source: string;
  /** 0..1 confidence; low-confidence events can be filtered out. */
  confidence?: number;
  /** Travel direction the event applies to, when known. */
  direction?: RoadSafetyDirection;
  /** Compass bearing (deg) the event faces, when known. */
  bearing?: number;
  /** Associated speed limit (km/h) when relevant (school zone / limit). */
  speedLimitKmh?: number | null;
  /** Active schedule, when the source provides reliable hours. */
  schedule?: { activeNow: boolean } | null;
  /** Optional per-event announcement thresholds (m). Defaults to 500/200. */
  announceThresholdsMeters?: number[];
};

export type ProjectedSafetyEvent = RoadSafetyEvent & {
  /** Distance (m) along the route from start to the event. */
  alongRouteMeters: number;
  /** Perpendicular distance (m) from the route to the event. */
  lateralMeters: number;
  /** Live distance (m) ahead of the driver. */
  distanceAheadMeters: number;
};

export type RoadSafetyProvider = {
  /** Country the provider is authorized for. */
  countryCode: string | null;
  getRoadSafetyEvents: (params: {
    routeGeometry: GeoJSON.Feature<GeoJSON.LineString>;
    countryCode: string | null;
  }) => Promise<RoadSafetyEvent[]> | RoadSafetyEvent[];
};

/**
 * Per-country enablement. Displaying speed cameras is regulated differently per
 * country; a category can be disabled per region. Defaults are conservative
 * (only categories with a real feed should be turned on per country).
 */
export type RoadSafetyCountryConfig = {
  enabledTypes: Record<RoadSafetyEventType, boolean>;
  thresholdsMeters: number[];
  /** Minimum confidence to surface an event. */
  minConfidence: number;
};

export const DEFAULT_SAFETY_CONFIG: RoadSafetyCountryConfig = {
  enabledTypes: {
    speed_camera: true,
    red_light_camera: true,
    speed_limit: true,
    stop_sign: true,
    school_zone: true,
  },
  thresholdsMeters: [500, 200],
  minConfidence: 0.5,
};

function toRad(value: number): number {
  return (value * Math.PI) / 180;
}

/** Project an arbitrary point onto the route polyline (pure). */
export function projectPointOntoRoute(
  point: CoordinatePoint,
  geometry: GeoJSON.Feature<GeoJSON.LineString> | null | undefined,
): { alongRouteMeters: number; lateralMeters: number; segmentIndex: number } | null {
  const coordinates = geometry?.geometry?.coordinates;
  if (!coordinates || coordinates.length < 2) return null;

  let best: {
    alongRouteMeters: number;
    lateralMeters: number;
    segmentIndex: number;
  } | null = null;
  let cumulative = 0;

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

    const latRad = toRad(startLat);
    const x1 = toRad(startLng) * Math.cos(latRad);
    const y1 = toRad(startLat);
    const x2 = toRad(endLng) * Math.cos(latRad);
    const y2 = toRad(endLat);
    const xp = toRad(point.longitude) * Math.cos(latRad);
    const yp = toRad(point.latitude);

    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((xp - x1) * dx + (yp - y1) * dy) / lenSq));

    const projLat = startLat + t * (endLat - startLat);
    const projLng = startLng + t * (endLng - startLng);
    const lateral = distanceMeters(point.latitude, point.longitude, projLat, projLng);
    const segLen = distanceMeters(startLat, startLng, endLat, endLng);

    if (!best || lateral < best.lateralMeters) {
      best = {
        lateralMeters: lateral,
        segmentIndex: index,
        alongRouteMeters: cumulative + segLen * t,
      };
    }
    cumulative += segLen;
  }

  return best;
}

function routeBearingAt(
  geometry: GeoJSON.Feature<GeoJSON.LineString>,
  segmentIndex: number,
): number | null {
  const coordinates = geometry.geometry.coordinates;
  const i = Math.min(Math.max(segmentIndex, 0), coordinates.length - 2);
  const startLng = Number(coordinates[i][0]);
  const startLat = Number(coordinates[i][1]);
  const endLng = Number(coordinates[i + 1][0]);
  const endLat = Number(coordinates[i + 1][1]);
  if (!Number.isFinite(startLat) || !Number.isFinite(endLat)) return null;
  const dLon = toRad(endLng - startLng);
  const y = Math.sin(dLon) * Math.cos(toRad(endLat));
  const x =
    Math.cos(toRad(startLat)) * Math.sin(toRad(endLat)) -
    Math.sin(toRad(startLat)) * Math.cos(toRad(endLat)) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Keep only events that are genuinely *ahead on the active route*:
 * - within a lateral corridor (rejects parallel roads),
 * - ahead of the driver (rejects events already passed),
 * - facing the direction of travel when a bearing/direction is known
 *   (rejects opposite-direction and behind events).
 */
export function projectSafetyEventsOntoRoute(params: {
  events: RoadSafetyEvent[];
  geometry: GeoJSON.Feature<GeoJSON.LineString> | null | undefined;
  traveledMeters: number;
  maxLateralMeters?: number;
  behindToleranceMeters?: number;
  maxAheadMeters?: number;
}): ProjectedSafetyEvent[] {
  const {
    events,
    geometry,
    traveledMeters,
    maxLateralMeters = 25,
    behindToleranceMeters = 15,
    maxAheadMeters = 2000,
  } = params;
  if (!geometry) return [];

  const projected: ProjectedSafetyEvent[] = [];

  for (const event of events) {
    const proj = projectPointOntoRoute(event.coordinate, geometry);
    if (!proj) continue;
    if (proj.lateralMeters > maxLateralMeters) continue; // parallel road

    const distanceAhead = proj.alongRouteMeters - traveledMeters;
    if (distanceAhead < -behindToleranceMeters) continue; // behind driver
    if (distanceAhead > maxAheadMeters) continue; // too far to matter yet

    if (event.direction === "backward") continue;
    if (
      event.bearing != null &&
      (event.direction === "forward" || event.direction === "unknown" || event.direction == null)
    ) {
      const routeBearing = routeBearingAt(geometry, proj.segmentIndex);
      if (routeBearing != null) {
        const diff = Math.abs(((event.bearing - routeBearing + 540) % 360) - 180);
        if (diff > 65) continue; // event faces the opposite direction
      }
    }

    projected.push({
      ...event,
      alongRouteMeters: proj.alongRouteMeters,
      lateralMeters: proj.lateralMeters,
      distanceAheadMeters: Math.max(0, distanceAhead),
    });
  }

  return projected.sort((a, b) => a.distanceAheadMeters - b.distanceAheadMeters);
}

type SafetyFlags = { a500: boolean; a200: boolean };

export type SafetyVoiceState = {
  routeVersion: string;
  byEvent: Record<string, SafetyFlags>;
};

export function initSafetyVoiceState(routeVersion = ""): SafetyVoiceState {
  return { routeVersion, byEvent: {} };
}

const SAFETY_BANDS = {
  far: 500,
  farBandTop: 550,
  near: 200,
  nearBandTop: 230,
} as const;

/** Resolve announcement bands from configurable thresholds (with tolerance). */
function resolveBands(thresholds?: { far?: number; near?: number }) {
  const far = thresholds?.far ?? SAFETY_BANDS.far;
  const near = thresholds?.near ?? SAFETY_BANDS.near;
  return {
    far,
    near,
    farBandTop: Math.round(far * 1.1),
    nearBandTop: Math.round(near * 1.15),
  };
}

function safetyLabel(
  event: ProjectedSafetyEvent,
  distanceMetersValue: number,
  locale: NavigationLocale,
): string {
  const d = Math.max(0, Math.round(distanceMetersValue / 10) * 10);
  const prefix =
    locale === "fr" ? `Dans ${d} mètres, ` : locale === "es" ? `En ${d} metros, ` : `In ${d} meters, `;
  const name: Record<RoadSafetyEventType, Record<NavigationLocale, string>> = {
    speed_camera: { en: "speed camera", fr: "radar de vitesse", es: "radar de velocidad" },
    red_light_camera: { en: "red light camera", fr: "radar de feu rouge", es: "cámara de semáforo" },
    speed_limit: { en: "speed limit change", fr: "changement de limitation", es: "cambio de límite" },
    stop_sign: { en: "stop sign", fr: "panneau stop", es: "señal de alto" },
    school_zone: { en: "school zone", fr: "zone scolaire", es: "zona escolar" },
  };
  const suffix =
    event.type === "school_zone" && distanceMetersValue <= SAFETY_BANDS.nearBandTop
      ? locale === "fr"
        ? ", ralentissez"
        : locale === "es"
          ? ", reduzca la velocidad"
          : ", slow down"
      : "";
  return `${prefix}${name[event.type][locale]}${suffix}`;
}

/**
 * 500 m / 200 m announcements for the nearest ahead safety event, with
 * per-event announce-once memory and reroute reset. Returns at most one
 * announcement (the most relevant one).
 */
export function computeSafetyAnnouncements(params: {
  state: SafetyVoiceState;
  routeVersion: string;
  events: ProjectedSafetyEvent[];
  locale: string | NavigationLocale;
  thresholds?: { far?: number; near?: number };
}): { state: SafetyVoiceState; announcement: VoiceAnnouncement | null } {
  const locale =
    typeof params.locale === "string"
      ? resolveNavigationLocale(params.locale)
      : params.locale;
  const bands = resolveBands(params.thresholds);

  let state = params.state;
  if (state.routeVersion !== params.routeVersion) {
    state = { routeVersion: params.routeVersion, byEvent: {} };
  }

  let announcement: VoiceAnnouncement | null = null;
  const byEvent = { ...state.byEvent };

  for (const event of params.events) {
    const flags = { ...(byEvent[event.id] ?? { a500: false, a200: false }) };
    const distance = event.distanceAheadMeters;

    if (!flags.a200 && distance <= bands.nearBandTop) {
      flags.a200 = true;
      flags.a500 = true;
      byEvent[event.id] = flags;
      if (!announcement) {
        announcement = {
          bucket: "200",
          maneuverId: `safety:${event.id}`,
          priority: VoicePriority.SafetyNear,
          text: safetyLabel(event, bands.near, locale),
        };
      }
      continue;
    }

    if (!flags.a500 && distance <= bands.farBandTop && distance > bands.nearBandTop) {
      flags.a500 = true;
      byEvent[event.id] = flags;
      if (!announcement) {
        announcement = {
          bucket: "500",
          maneuverId: `safety:${event.id}`,
          priority: VoicePriority.Safety500,
          text: safetyLabel(event, bands.far, locale),
        };
      }
      continue;
    }

    byEvent[event.id] = flags;
  }

  return { state: { routeVersion: params.routeVersion, byEvent }, announcement };
}

/**
 * Default provider — returns no events. Cameras / stop signs / school zones are
 * NOT available from the current Mapbox driving profile; this is intentionally
 * empty so the UI never shows fabricated hazards. Wire a real
 * `RoadSafetyProvider` (authorized backend feed / OSM Overpass with allowed
 * attributes / licensed provider) to populate it per supported country.
 */
export async function getRoadSafetyEvents(_params: {
  routeGeometry: GeoJSON.Feature<GeoJSON.LineString> | null | undefined;
  countryCode: string | null;
  provider?: RoadSafetyProvider | null;
}): Promise<RoadSafetyEvent[]> {
  const { provider, routeGeometry, countryCode } = _params;
  if (!provider || !routeGeometry) return [];
  try {
    const events = await provider.getRoadSafetyEvents({ routeGeometry, countryCode });
    return Array.isArray(events) ? events : [];
  } catch {
    return [];
  }
}
