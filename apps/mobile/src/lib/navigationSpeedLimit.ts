import { distanceMeters } from "./coordinates";
import { pointAtRouteDistance } from "./driverNavigationRouteStyle";

/** Limites de vitesse — Mapbox Directions API (`annotations=maxspeed`, profil driving). */

export type MapboxMaxSpeedRaw = {
  speed?: number;
  unit?: "km/h" | "mph" | string;
  unknown?: boolean;
  none?: boolean;
};

export type RouteSpeedLimitSegment = {
  fromMeters: number;
  toMeters: number;
  /** Limite convertie en km/h pour comparaison avec le GPS. */
  speedLimitKmh: number;
  /** Valeur affichée sur le panneau (unité locale Mapbox). */
  postedSpeed: number;
  postedUnit: "km/h" | "mph";
};

export type RouteSpeedLimitState = {
  speedLimitKmh: number | null;
  postedSpeed: number | null;
  postedUnit: "km/h" | "mph" | null;
  isSpeeding: boolean;
};

const MPH_TO_KMH = 1.609344;

export function maxSpeedRawToKmh(raw: MapboxMaxSpeedRaw | null | undefined): number | null {
  if (!raw || raw.unknown || raw.none) return null;
  const speed = Number(raw.speed);
  if (!Number.isFinite(speed) || speed <= 0) return null;
  if (raw.unit === "mph") return Math.round(speed * MPH_TO_KMH);
  return Math.round(speed);
}

export function parseRouteSpeedLimitSegments(
  geometry: GeoJSON.Feature<GeoJSON.LineString>,
  maxspeed: MapboxMaxSpeedRaw[] | null | undefined,
): RouteSpeedLimitSegment[] {
  const coords = geometry.geometry.coordinates;
  if (!coords || coords.length < 2 || !maxspeed?.length) return [];

  const segments: RouteSpeedLimitSegment[] = [];
  let fromMeters = 0;

  for (let i = 0; i < coords.length - 1; i += 1) {
    const startLat = Number(coords[i][1]);
    const startLng = Number(coords[i][0]);
    const endLat = Number(coords[i + 1][1]);
    const endLng = Number(coords[i + 1][0]);
    const segLen = distanceMeters(startLat, startLng, endLat, endLng);
    const raw = maxspeed[i] ?? maxspeed[maxspeed.length - 1];
    const speedLimitKmh = maxSpeedRawToKmh(raw);
    if (speedLimitKmh != null && raw?.speed != null) {
      const postedUnit: "km/h" | "mph" = raw.unit === "mph" ? "mph" : "km/h";
      segments.push({
        fromMeters,
        toMeters: fromMeters + segLen,
        speedLimitKmh,
        postedSpeed: Math.round(Number(raw.speed)),
        postedUnit,
      });
    }
    fromMeters += segLen;
  }

  return segments;
}

export function resolveRouteSpeedLimitAtMeters(
  segments: RouteSpeedLimitSegment[],
  traveledMeters: number,
): Pick<RouteSpeedLimitState, "speedLimitKmh" | "postedSpeed" | "postedUnit"> {
  if (!segments.length) {
    return { speedLimitKmh: null, postedSpeed: null, postedUnit: null };
  }

  const distance = Math.max(0, traveledMeters);
  const match =
    segments.find(
      (segment) => distance >= segment.fromMeters && distance < segment.toMeters,
    ) ?? segments[segments.length - 1];

  return {
    speedLimitKmh: match.speedLimitKmh,
    postedSpeed: match.postedSpeed,
    postedUnit: match.postedUnit,
  };
}

/** Dépassement : rouge dès que vitesse > limite ; retour normal dès vitesse ≤ limite. */
export function isDriverSpeeding(
  speedMps: number | null | undefined,
  speedLimitKmh: number | null | undefined,
): boolean {
  if (speedMps == null || !Number.isFinite(speedMps) || speedMps < 0) return false;
  if (speedLimitKmh == null || !Number.isFinite(speedLimitKmh) || speedLimitKmh <= 0) {
    return false;
  }
  return speedMps * 3.6 > speedLimitKmh;
}

export function resolveRouteSpeedLimitState(params: {
  segments: RouteSpeedLimitSegment[];
  traveledMeters: number;
  speedMps: number | null | undefined;
}): RouteSpeedLimitState {
  const limit = resolveRouteSpeedLimitAtMeters(params.segments, params.traveledMeters);
  return {
    ...limit,
    isSpeeding: isDriverSpeeding(params.speedMps, limit.speedLimitKmh),
  };
}

/** Décalage visuel route ↔ icône (iconOffset écran + pitch 3D). */
export function resolveVisualRouteSplitMeters(
  geometry: GeoJSON.Feature<GeoJSON.LineString>,
  traveledMeters: number,
  leadMeters: number,
): number {
  if (leadMeters <= 0) return traveledMeters;
  const located = pointAtRouteDistance(geometry, traveledMeters + leadMeters);
  if (!located) return traveledMeters + leadMeters;
  return traveledMeters + leadMeters;
}
