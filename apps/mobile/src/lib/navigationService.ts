import type { RefObject } from "react";
import Mapbox from "@rnmapbox/maps";
import type { CoordinatePoint } from "./coordinates";
import { distanceMeters } from "./coordinates";
import { distanceToRouteMeters } from "./navigationProgress";
import { getMapboxToken, isMapboxConfigured } from "./mapboxConfig";
import { resolveNavigationLocale } from "./navigationLocale";
import {
  parseRouteSpeedLimitSegments,
  type MapboxMaxSpeedRaw,
  type RouteSpeedLimitSegment,
} from "./navigationSpeedLimit";
import { parseMapboxLanes, type NavigationLane } from "./navigationLanes";
import { extractMapboxExitNumber } from "./navigationExit";

export type RoutePoint = CoordinatePoint;

/** One Mapbox `voiceInstructions` prompt (already localized by the API). */
export type NavigationVoicePrompt = {
  /** Distance before the maneuver at which Mapbox recommends speaking. */
  distanceAlongGeometryMeters: number;
  announcement: string;
};

export type NavigationRouteStep = {
  instruction: string;
  distanceMeters: number;
  durationSeconds: number;
  /** Mapbox `maneuver.type` (turn, roundabout, fork, arrive, …). */
  maneuverType?: string;
  /** Mapbox `maneuver.modifier` (left, right, slight left, uturn, …). */
  maneuverModifier?: string;
  /**
   * Mapbox `maneuver.exit` — roundabout / rotary exit index when provided.
   * Never invent; omit when Mapbox does not send it.
   */
  roundaboutExit?: number;
  /**
   * Highway exit designation from Mapbox `exits` / instruction when present
   * (e.g. "398B", "12"). Never invent.
   */
  exitNumber?: string;
  /** `step.name` — road being driven for this step. */
  roadName?: string;
  /** GPS coordinate of the maneuver point (`maneuver.location`). */
  maneuverPoint?: CoordinatePoint;
  /**
   * Cumulative distance (m) from the route start to this step's maneuver point.
   * Filled during parsing so the live engine can compute distance-to-maneuver
   * from the driver's traveled distance without relying on a static index.
   */
  maneuverAlongRouteMeters?: number;
  /** Mapbox pre-localized voice prompts for this step, when available. */
  voicePrompts?: NavigationVoicePrompt[];
  /** Lane guidance for the approach to this step's maneuver, when available. */
  lanes?: NavigationLane[];
};

export type NavigationRoute = {
  distanceMeters: number;
  durationSeconds: number;
  etaMinutes: number;
  geometry: GeoJSON.Feature<GeoJSON.LineString>;
  steps: NavigationRouteStep[];
  routeIndex?: number;
  /** Limitations Mapbox Directions (`annotations=maxspeed`). */
  speedLimitSegments: RouteSpeedLimitSegment[];
};

const DIRECTIONS_BASE =
  "https://api.mapbox.com/directions/v5/mapbox/driving";

/** Map app locale to Mapbox Directions language code. */
export function mapboxDirectionsLanguage(appLocale: string): string {
  return resolveNavigationLocale(appLocale);
}

export type FetchNavigationRouteOptions = {
  language?: string;
  alternatives?: boolean;
};

function validateCoords(point: RoutePoint): boolean {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude)
  );
}

function buildCoords(points: RoutePoint[]): string {
  return points.map((p) => `${p.longitude},${p.latitude}`).join(";");
}

function parseVoicePrompts(raw: unknown): NavigationVoicePrompt[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const prompts = raw
    .map((entry) => {
      const item = entry as {
        distanceAlongGeometry?: number;
        announcement?: string;
      };
      const announcement = String(item?.announcement || "").trim();
      const distance = Number(item?.distanceAlongGeometry);
      if (!announcement || !Number.isFinite(distance)) return null;
      return {
        distanceAlongGeometryMeters: Math.max(0, distance),
        announcement,
      };
    })
    .filter((entry): entry is NavigationVoicePrompt => entry != null);
  return prompts.length ? prompts : undefined;
}

function parseManeuverPoint(location: unknown): CoordinatePoint | undefined {
  if (!Array.isArray(location) || location.length < 2) return undefined;
  const longitude = Number(location[0]);
  const latitude = Number(location[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  return { latitude, longitude };
}

function parseSteps(rawSteps: unknown[]): NavigationRouteStep[] {
  let alongRouteMeters = 0;

  return rawSteps
    .map((step) => {
      const item = step as {
        maneuver?: {
          instruction?: string;
          type?: string;
          modifier?: string;
          location?: number[];
          exit?: number | string;
        };
        name?: string;
        distance?: number;
        duration?: number;
        voiceInstructions?: unknown;
        intersections?: unknown;
        exits?: string | string[];
        ref?: string;
      };

      const instruction = String(item?.maneuver?.instruction || "").trim();
      const distanceMeters = Math.round(Number(item.distance) || 0);
      if (!instruction) {
        alongRouteMeters += distanceMeters;
        return null;
      }

      const maneuverType = item.maneuver?.type
        ? String(item.maneuver.type).trim().toLowerCase()
        : undefined;
      const maneuverModifier = item.maneuver?.modifier
        ? String(item.maneuver.modifier).trim().toLowerCase()
        : undefined;

      const roundaboutExitRaw = Number(item.maneuver?.exit);
      const roundaboutExit =
        Number.isFinite(roundaboutExitRaw) && roundaboutExitRaw > 0
          ? Math.round(roundaboutExitRaw)
          : undefined;

      const exitNumber = extractMapboxExitNumber({
        exits: item.exits,
        ref: item.ref,
        instruction,
        maneuverType,
      });

      const parsed: NavigationRouteStep = {
        instruction,
        distanceMeters,
        durationSeconds: Math.round(Number(item.duration) || 0),
        maneuverType,
        maneuverModifier,
        roundaboutExit,
        exitNumber: exitNumber || undefined,
        roadName: item.name ? String(item.name).trim() || undefined : undefined,
        maneuverPoint: parseManeuverPoint(item.maneuver?.location),
        maneuverAlongRouteMeters: alongRouteMeters,
        voicePrompts: parseVoicePrompts(item.voiceInstructions),
        lanes: parseMapboxLanes(item.intersections),
      };

      alongRouteMeters += distanceMeters;
      return parsed;
    })
    .filter((step): step is NavigationRouteStep => step != null);
}

export function isMapboxDirectionsAvailable(): boolean {
  return isMapboxConfigured();
}

function parseRoute(raw: {
  geometry?: { coordinates?: number[][] };
  distance?: number;
  duration?: number;
  legs?: Array<{
    steps?: unknown[];
    annotation?: { maxspeed?: MapboxMaxSpeedRaw[] };
  }>;
}, routeIndex = 0): NavigationRoute | null {
  const coordinates = raw?.geometry?.coordinates;
  if (!coordinates?.length) return null;

  const geometry: GeoJSON.Feature<GeoJSON.LineString> = {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates,
    },
  };

  const durationSeconds = Math.round(raw.duration || 0);
  const distanceMetersValue = Math.round(raw.distance || 0);
  const rawSteps = raw.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
  const maxspeed = raw.legs?.flatMap((leg) => leg.annotation?.maxspeed ?? []) ?? [];

  return {
    geometry,
    durationSeconds,
    distanceMeters: distanceMetersValue,
    etaMinutes: Math.max(1, Math.round(durationSeconds / 60)),
    steps: parseSteps(rawSteps),
    routeIndex,
    speedLimitSegments: parseRouteSpeedLimitSegments(geometry, maxspeed),
  };
}

export async function fetchNavigationRoutes(
  origin: RoutePoint,
  destination: RoutePoint,
  waypoints: RoutePoint[] = [],
  signal?: AbortSignal,
  options: FetchNavigationRouteOptions = {},
): Promise<NavigationRoute[]> {
  try {
    if (!isMapboxConfigured()) return [];
    if (!validateCoords(origin)) return [];
    if (!validateCoords(destination)) return [];

    const coords = buildCoords([origin, ...waypoints, destination]);
    const token = getMapboxToken();
    const language = mapboxDirectionsLanguage(options.language ?? "en");
    const alternatives = options.alternatives === true;

    const url =
      `${DIRECTIONS_BASE}/${coords}` +
      `?alternatives=${alternatives ? "true" : "false"}` +
      `&continue_straight=true` +
      `&geometries=geojson` +
      `&overview=full` +
      `&annotations=maxspeed` +
      `&steps=true` +
      `&banner_instructions=true` +
      `&voice_instructions=true` +
      `&voice_units=metric` +
      `&language=${encodeURIComponent(language)}` +
      `&access_token=${token}`;

    const response = await fetch(url, { signal });
    if (!response.ok) return [];

    const json = (await response.json()) as {
      routes?: Array<{
        geometry?: { coordinates?: number[][] };
        distance?: number;
        duration?: number;
        legs?: Array<{
          steps?: unknown[];
          annotation?: { maxspeed?: MapboxMaxSpeedRaw[] };
        }>;
      }>;
    };

    return (json?.routes ?? [])
      .map((route, index) => parseRoute(route, index))
      .filter((route): route is NavigationRoute => route != null);
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") {
      return [];
    }
    return [];
  }
}

export async function fetchNavigationRoute(
  origin: RoutePoint,
  destination: RoutePoint,
  waypoints: RoutePoint[] = [],
  signal?: AbortSignal,
  options: FetchNavigationRouteOptions = {},
): Promise<NavigationRoute | null> {
  const routes = await fetchNavigationRoutes(
    origin,
    destination,
    waypoints,
    signal,
    options,
  );
  return routes[0] ?? null;
}

export async function fitCameraToRoute(
  cameraRef: RefObject<Mapbox.Camera | null>,
  route: GeoJSON.Feature<GeoJSON.LineString> | null | undefined,
): Promise<void> {
  try {
    if (!cameraRef.current || !route) return;

    const coords = route.geometry.coordinates;
    if (!coords?.length) return;

    const ne = [
      Math.max(...coords.map((c) => c[0])),
      Math.max(...coords.map((c) => c[1])),
    ];

    const sw = [
      Math.min(...coords.map((c) => c[0])),
      Math.min(...coords.map((c) => c[1])),
    ];

    cameraRef.current.fitBounds(
      ne as [number, number],
      sw as [number, number],
      80,
      1200,
    );
  } catch {
    // Camera failures must not crash navigation
  }
}

export function calculateHeading(from: RoutePoint, to: RoutePoint): number {
  const dLon = ((to.longitude - from.longitude) * Math.PI) / 180;
  const lat1 = (from.latitude * Math.PI) / 180;
  const lat2 = (to.latitude * Math.PI) / 180;

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function distanceBetweenPoints(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  return distanceMeters(lat1, lon1, lat2, lon2);
}

export function shouldReroute(
  current: RoutePoint,
  route: GeoJSON.Feature<GeoJSON.LineString> | null | undefined,
  thresholdMeters = 90,
): boolean {
  try {
    if (!validateCoords(current)) return false;
    if (!route?.geometry?.coordinates?.length) return false;

    const distance = distanceToRouteMeters(current, route);
    return Number.isFinite(distance) && distance > thresholdMeters;
  } catch {
    return false;
  }
}

export function smoothHeading(current: number, next: number, factor = 0.28): number {
  const delta = ((next - current + 540) % 360) - 180;
  return (current + delta * factor + 360) % 360;
}
