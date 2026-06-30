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

export type RoutePoint = CoordinatePoint;

export type NavigationRouteStep = {
  instruction: string;
  distanceMeters: number;
  durationSeconds: number;
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

function parseSteps(rawSteps: unknown[]): NavigationRouteStep[] {
  return rawSteps
    .map((step) => {
      const item = step as {
        maneuver?: { instruction?: string };
        distance?: number;
        duration?: number;
      };

      const instruction = String(item?.maneuver?.instruction || "").trim();
      if (!instruction) return null;

      return {
        instruction,
        distanceMeters: Math.round(Number(item.distance) || 0),
        durationSeconds: Math.round(Number(item.duration) || 0),
      };
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
