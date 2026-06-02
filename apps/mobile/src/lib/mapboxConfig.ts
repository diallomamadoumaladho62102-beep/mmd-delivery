import Mapbox from "@rnmapbox/maps";

const MAPBOX_TOKEN =
  process.env.EXPO_PUBLIC_MAPBOX_TOKEN || process.env.MAPBOX_TOKEN || "";

let tokenApplied = false;

export function getMapboxToken(): string {
  return MAPBOX_TOKEN;
}

export function isMapboxConfigured(): boolean {
  return MAPBOX_TOKEN.trim().length > 0;
}

export function ensureMapboxTokenApplied(): boolean {
  if (!isMapboxConfigured()) return false;

  if (!tokenApplied) {
    Mapbox.setAccessToken(MAPBOX_TOKEN);
    tokenApplied = true;
  }

  return true;
}

export const MAP_STYLE_STREETS =
  (Mapbox as { StyleURL?: { Street?: string } }).StyleURL?.Street ??
  "mapbox://styles/mapbox/streets-v12";

export const MAP_STYLE_DARK =
  (Mapbox as { StyleURL?: { Dark?: string } }).StyleURL?.Dark ??
  "mapbox://styles/mapbox/dark-v11";
