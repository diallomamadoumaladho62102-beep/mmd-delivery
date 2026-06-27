import type { Feature, LineString, Position } from "geojson";
import type { CoordinatePoint } from "./coordinates";
import { distanceMeters } from "./coordinates";
import {
  NAV_ARROW_TIP_AHEAD_METERS,
  ROUTE_FUTURE_GLOW_MULTIPLIER,
  ROUTE_FUTURE_WIDTH_RATIO,
  ROUTE_TRAVELED_WIDTH_RATIO,
} from "./driverNavigationVisual";

export type RouteSplit = {
  anchor: CoordinatePoint;
  segmentIndex: number;
  forwardBearing: number;
  traveled: Feature<LineString> | null;
  /** Cyan plein — démarre à l'ancre (sous l'icône), uniquement vers l'avant. */
  future: Feature<LineString>;
  /** Halo sans blur à l'ancre — évite le cyan visible derrière l'icône. */
  futureGlow: Feature<LineString> | null;
};

const MAX_TRAVELED_BEHIND_METERS = 55;
const MIN_TRAVELED_BEHIND_METERS = 3;
/** Vert s'arrête avant la base — l'icône masque la jonction (Waze). */
const TRAVELED_STOP_BEFORE_ANCHOR_METERS = 4;
/** Halo cyan — après la pointe. */
const FUTURE_GLOW_EXTRA_AHEAD_METERS = 8;

function coordinatePoint(coord: Position): CoordinatePoint {
  return {
    latitude: Number(coord[1]),
    longitude: Number(coord[0]),
  };
}

/** Point exact sur la polyline Mapbox à N mètres depuis le départ. */
export function pointAtRouteDistance(
  geometry: Feature<LineString>,
  distanceMetersAlong: number,
): { point: CoordinatePoint; segmentIndex: number } | null {
  const coords = geometry.geometry.coordinates;
  if (coords.length < 2) return null;

  const target = Math.max(0, distanceMetersAlong);
  let walked = 0;

  for (let i = 0; i < coords.length - 1; i += 1) {
    const start = coordinatePoint(coords[i]);
    const end = coordinatePoint(coords[i + 1]);
    const segLen = distanceMeters(
      start.latitude,
      start.longitude,
      end.latitude,
      end.longitude,
    );

    if (segLen <= 0) continue;

    if (walked + segLen >= target - 0.01 || i === coords.length - 2) {
      const t = Math.max(0, Math.min(1, (target - walked) / segLen));
      return {
        segmentIndex: i,
        point: {
          latitude: start.latitude + t * (end.latitude - start.latitude),
          longitude: start.longitude + t * (end.longitude - start.longitude),
        },
      };
    }

    walked += segLen;
  }

  const last = coordinatePoint(coords[coords.length - 1]);
  return {
    segmentIndex: Math.max(0, coords.length - 2),
    point: last,
  };
}

function bearingBetween(start: CoordinatePoint, end: CoordinatePoint): number {
  const dLon = ((end.longitude - start.longitude) * Math.PI) / 180;
  const lat1 = (start.latitude * Math.PI) / 180;
  const lat2 = (end.latitude * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Cap route devant l'ancre — point 12 m plus loin sur la polyline. */
export function forwardBearingFromAnchor(
  geometry: Feature<LineString>,
  anchor: CoordinatePoint,
  traveledMeters: number,
): number {
  const ahead = pointAtRouteDistance(geometry, traveledMeters + 12);
  if (!ahead) return 0;
  const dist = distanceMeters(
    anchor.latitude,
    anchor.longitude,
    ahead.point.latitude,
    ahead.point.longitude,
  );
  if (dist < 2) {
    const further = pointAtRouteDistance(geometry, traveledMeters + 30);
    if (further) return bearingBetween(anchor, further.point);
  }
  return bearingBetween(anchor, ahead.point);
}

function pointAheadOnSegment(
  anchor: CoordinatePoint,
  segEnd: CoordinatePoint,
  distToEnd: number,
  aheadMeters: number,
): CoordinatePoint | null {
  if (distToEnd <= aheadMeters + 0.05) return null;
  const t = aheadMeters / distToEnd;
  return {
    longitude: anchor.longitude + t * (segEnd.longitude - anchor.longitude),
    latitude: anchor.latitude + t * (segEnd.latitude - anchor.latitude),
  };
}

function pointBehindOnSegment(
  anchor: CoordinatePoint,
  segStart: CoordinatePoint,
  behindLen: number,
  backMeters: number,
): CoordinatePoint {
  if (behindLen <= backMeters + 0.05) return segStart;
  const t = backMeters / behindLen;
  return {
    longitude: anchor.longitude + t * (segStart.longitude - anchor.longitude),
    latitude: anchor.latitude + t * (segStart.latitude - anchor.latitude),
  };
}

function appendRouteTail(
  target: Position[],
  coords: Position[],
  fromIndex: number,
): void {
  for (let i = fromIndex; i < coords.length; i += 1) {
    const lng = Number(coords[i][0]);
    const lat = Number(coords[i][1]);
    const last = target[target.length - 1];
    if (last && Math.abs(last[0] - lng) < 1e-9 && Math.abs(last[1] - lat) < 1e-9) {
      continue;
    }
    target.push([lng, lat]);
  }
}

/**
 * Split Waze — vert jusqu'à la base GPS (derrière), cyan depuis la pointe (devant).
 *       │  cyan
 *       ▲  icône
 *       │  vert (Waze — icône masque la jonction)
 */
export function splitNavigationRoute(
  geometry: Feature<LineString>,
  traveledMeters: number,
): RouteSplit | null {
  const coords = geometry.geometry.coordinates;
  if (coords.length < 2) return null;

  const located = pointAtRouteDistance(geometry, traveledMeters);
  if (!located) return null;

  const { point: anchor, segmentIndex } = located;
  const segStart = coordinatePoint(coords[segmentIndex]);
  const segEnd = coordinatePoint(coords[segmentIndex + 1]);

  const distToEnd = distanceMeters(
    anchor.latitude,
    anchor.longitude,
    segEnd.latitude,
    segEnd.longitude,
  );

  const behindLen = distanceMeters(
    anchor.latitude,
    anchor.longitude,
    segStart.latitude,
    segStart.longitude,
  );

  const tipPoint = pointAheadOnSegment(
    anchor,
    segEnd,
    distToEnd,
    NAV_ARROW_TIP_AHEAD_METERS,
  );

  let future: Feature<LineString> | null = null;
  if (tipPoint) {
    const futureCoords: Position[] = [[tipPoint.longitude, tipPoint.latitude]];
    futureCoords.push([segEnd.longitude, segEnd.latitude]);
    appendRouteTail(futureCoords, coords, segmentIndex + 2);
    if (futureCoords.length >= 2) {
      future = {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: futureCoords },
      };
    }
  }

  const glowAhead =
    NAV_ARROW_TIP_AHEAD_METERS + FUTURE_GLOW_EXTRA_AHEAD_METERS;
  const glowStart = pointAheadOnSegment(anchor, segEnd, distToEnd, glowAhead);
  let futureGlow: Feature<LineString> | null = null;
  if (glowStart) {
    const glowCoords: Position[] = [[glowStart.longitude, glowStart.latitude]];
    if (distToEnd > glowAhead + 0.15) {
      glowCoords.push([segEnd.longitude, segEnd.latitude]);
    }
    appendRouteTail(glowCoords, coords, segmentIndex + 2);
    if (glowCoords.length >= 2) {
      futureGlow = {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: glowCoords },
      };
    }
  }

  let traveled: Feature<LineString> | null = null;
  const traveledEnd = pointBehindOnSegment(
    anchor,
    segStart,
    behindLen,
    TRAVELED_STOP_BEFORE_ANCHOR_METERS,
  );

  const traveledCoords: Position[] = [
    [traveledEnd.longitude, traveledEnd.latitude],
  ];
  let budget = MAX_TRAVELED_BEHIND_METERS - TRAVELED_STOP_BEFORE_ANCHOR_METERS;

  const onCurrentSegment = distanceMeters(
    traveledEnd.latitude,
    traveledEnd.longitude,
    segStart.latitude,
    segStart.longitude,
  );

  if (onCurrentSegment > 0.4 && budget > 0) {
    if (budget >= onCurrentSegment) {
      traveledCoords.unshift([segStart.longitude, segStart.latitude]);
      budget -= onCurrentSegment;
    } else {
      const t = 1 - budget / onCurrentSegment;
      traveledCoords.unshift([
        segStart.longitude + t * (traveledEnd.longitude - segStart.longitude),
        segStart.latitude + t * (traveledEnd.latitude - segStart.latitude),
      ]);
      budget = 0;
    }
  }

  for (let i = segmentIndex - 1; i >= 0 && budget > 0.4; i -= 1) {
    const prev = coordinatePoint(coords[i]);
    const next = coordinatePoint(coords[i + 1]);
    const segLen = distanceMeters(
      prev.latitude,
      prev.longitude,
      next.latitude,
      next.longitude,
    );
    if (segLen <= 0) continue;

    if (budget >= segLen) {
      traveledCoords.unshift([prev.longitude, prev.latitude]);
      budget -= segLen;
    } else {
      const t = budget / segLen;
      traveledCoords.unshift([
        next.longitude + t * (prev.longitude - next.longitude),
        next.latitude + t * (prev.latitude - next.latitude),
      ]);
      budget = 0;
    }
  }

  if (traveledCoords.length >= 2) {
    traveled = {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: traveledCoords },
    };
  }

  return {
    anchor,
    segmentIndex,
    forwardBearing: forwardBearingFromAnchor(geometry, anchor, traveledMeters),
    traveled,
    future: future ?? {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [] },
    },
    futureGlow,
  };
}

export function routeLineWidths(screenWidth: number) {
  return {
    future: routeLineWidthExpression(screenWidth, ROUTE_FUTURE_WIDTH_RATIO),
    futureGlow: routeLineWidthExpression(
      screenWidth,
      ROUTE_FUTURE_WIDTH_RATIO * ROUTE_FUTURE_GLOW_MULTIPLIER,
    ),
    traveled: routeLineWidthExpression(screenWidth, ROUTE_TRAVELED_WIDTH_RATIO),
  };
}

export function routeLineWidthPx(
  screenWidth: number,
  widthRatio: number,
): number {
  return Math.max(7, Math.round(screenWidth * widthRatio));
}

export function routeLineWidthExpression(
  screenWidth: number,
  widthRatio: number,
): unknown {
  const base = routeLineWidthPx(screenWidth, widthRatio);
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    15,
    base * 0.88,
    16,
    base,
    17,
    base * 1.08,
  ];
}
