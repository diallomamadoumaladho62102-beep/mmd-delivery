import type MapboxGL from "@rnmapbox/maps";
import Constants from "expo-constants";

/** Canonical runtime token: EXPO_PUBLIC_MAPBOX_TOKEN (env or app.config extra). */
const MAPBOX_TOKEN =
  String(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "").trim() ||
  String(
    (Constants.expoConfig?.extra as Record<string, unknown> | undefined)
      ?.EXPO_PUBLIC_MAPBOX_TOKEN ?? "",
  ).trim();

let mapboxModule: typeof MapboxGL | null = null;
let tokenApplied = false;

function loadMapboxModule(): typeof MapboxGL | null {
  if (mapboxModule) return mapboxModule;
  try {
    // Lazy require: avoid initializing Mapbox native bindings at app bootstrap.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mapboxModule = require("@rnmapbox/maps").default as typeof MapboxGL;
    return mapboxModule;
  } catch (error) {
    if (__DEV__) {
      console.log("[mapboxConfig] Failed to load @rnmapbox/maps:", error);
    }
    return null;
  }
}

export function getMapboxModule(): typeof MapboxGL | null {
  return loadMapboxModule();
}

export function getMapboxToken(): string {
  return MAPBOX_TOKEN;
}

export function isMapboxConfigured(): boolean {
  return MAPBOX_TOKEN.trim().length > 0;
}

export function ensureMapboxTokenApplied(): boolean {
  if (!isMapboxConfigured()) return false;

  const Mapbox = loadMapboxModule();
  if (!Mapbox) return false;

  if (!tokenApplied) {
    Mapbox.setAccessToken(MAPBOX_TOKEN);
    tokenApplied = true;
  }

  return true;
}

export function getMapStyleStreets(): string {
  return "mapbox://styles/mapbox/streets-v12";
}

export function getMapStyleDark(): string {
  const Mapbox = loadMapboxModule();
  return (
    (Mapbox as { StyleURL?: { Dark?: string } } | null)?.StyleURL?.Dark ??
    "mapbox://styles/mapbox/dark-v11"
  );
}

/** Style clair naturel — rues, bâtiments et POI visibles (comme Waze / Google Maps jour). */
export function getMapStyleNavigation(): string {
  return getMapStyleStreets();
}

/** Light Mapbox style with live traffic congestion coloring. */
export function getMapStyleTrafficDay(): string {
  return "mapbox://styles/mapbox/navigation-day-v1";
}

/** @deprecated Use getMapStyleStreets() for lazy Mapbox access */
export const MAP_STYLE_STREETS = "mapbox://styles/mapbox/streets-v12";

/** @deprecated Use getMapStyleDark() for lazy Mapbox access */
export const MAP_STYLE_DARK = "mapbox://styles/mapbox/dark-v11";
