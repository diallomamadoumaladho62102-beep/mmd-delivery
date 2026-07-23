import type { Feature, LineString, Position } from "geojson";
import type { CoordinatePoint } from "./coordinates";
import { distanceMeters } from "./coordinates";
import {
  NAV_ARROW_TIP_AHEAD_METERS,
  NAV_ROUTE_ICON_LEAD_METERS,
  junctionRouteMetersFromTraveled,
  ROUTE_GLOW_WIDTH_RATIO,
  ROUTE_LINE_WIDTH_RATIO,
} from "./driverNavigationVisual";

export type RouteSplit = {
  anchor: CoordinatePoint;
  segmentIndex: number;
  forwardBearing: number;
  /** Distance route (m) du point de transition vert/cyan. */
  junctionRouteMeters: number;
  traveled: Feature<LineString> | null;
  /** Cyan — démarre au centre icône, uniquement vers l'avant. */
  future: Feature<LineString>;
  futureGlow: Feature<LineString> | null;
};

const MAX_TRAVELED_BEHIND_METERS = 55;
const FUTURE_GLOW_EXTRA_AHEAD_METERS = 8;

function coordinatePoint(coord: Position): CoordinatePoint {
  return {
    latitude: Number(coord[1]),
    longitude: Number(coord[0]),
  };
}

function positionEqual(a: Position, b: Position): boolean {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

function pushPosition(target: Position[], coord: Position): void {
  const last = target[target.length - 1];
  if (last && positionEqual(last, coord)) return;
  target.push(coord);
}

function interpolatePosition(
  start: CoordinatePoint,
  end: CoordinatePoint,
  t: number,
): Position {
  return [
    start.longitude + t * (end.longitude - start.longitude),
    start.latitude + t * (end.latitude - start.latitude),
  ];
}

export function routeTotalMeters(coords: Position[]): number {
  let total = 0;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const start = coordinatePoint(coords[i]);
    const end = coordinatePoint(coords[i + 1]);
    total += distanceMeters(
      start.latitude,
      start.longitude,
      end.latitude,
      end.longitude,
    );
  }
  return total;
}

/** Extrait une portion de polyline Mapbox entre startMeters et endMeters. */
export function extractRouteSlice(
  geometry: Feature<LineString>,
  startMeters: number,
  endMeters: number,
): Position[] {
  const coords = geometry.geometry.coordinates;
  if (coords.length < 2) return [];

  const start = Math.max(0, startMeters);
  const end = Math.max(start, endMeters);
  const slice: Position[] = [];
  let walked = 0;

  for (let i = 0; i < coords.length - 1; i += 1) {
    const segStart = coordinatePoint(coords[i]);
    const segEnd = coordinatePoint(coords[i + 1]);
    const segLen = distanceMeters(
      segStart.latitude,
      segStart.longitude,
      segEnd.latitude,
      segEnd.longitude,
    );
    if (segLen <= 0) continue;

    const segStartM = walked;
    const segEndM = walked + segLen;

    if (segEndM < start - 1e-6) {
      walked += segLen;
      continue;
    }
    if (segStartM > end + 1e-6) break;

    if (slice.length === 0) {
      if (start <= segStartM + 1e-6) {
        pushPosition(slice, [segStart.longitude, segStart.latitude]);
      } else if (start < segEndM - 1e-6) {
        const t = (start - segStartM) / segLen;
        pushPosition(slice, interpolatePosition(segStart, segEnd, t));
      }
    }

    if (end >= segEndM - 1e-6) {
      pushPosition(slice, [segEnd.longitude, segEnd.latitude]);
    } else if (end > segStartM + 1e-6 && end < segEndM - 1e-6) {
      const t = (end - segStartM) / segLen;
      pushPosition(slice, interpolatePosition(segStart, segEnd, t));
      break;
    }

    walked += segLen;
  }

  return slice;
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

function lineFeature(coords: Position[]): Feature<LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: coords },
  };
}

/**
 * Split Waze — distance absolue sur la polyline Mapbox :
 * vert jusqu'au centre icône, cyan depuis le centre icône (même point).
 */
export function splitNavigationRoute(
  geometry: Feature<LineString>,
  traveledMeters: number,
): RouteSplit | null {
  const coords = geometry.geometry.coordinates;
  if (coords.length < 2) return null;

  const anchorRouteMeters = traveledMeters + NAV_ROUTE_ICON_LEAD_METERS;
  const junctionRouteMeters = junctionRouteMetersFromTraveled(traveledMeters);

  const anchorLocated = pointAtRouteDistance(geometry, anchorRouteMeters);
  if (!anchorLocated) return null;

  const { point: anchor, segmentIndex } = anchorLocated;
  const totalMeters = routeTotalMeters(coords);

  const junctionLocated = pointAtRouteDistance(geometry, junctionRouteMeters);
  if (!junctionLocated) return null;

  const junctionCoord: Position = [
    junctionLocated.point.longitude,
    junctionLocated.point.latitude,
  ];

  const traveledCoords = extractRouteSlice(
    geometry,
    Math.max(0, junctionRouteMeters - MAX_TRAVELED_BEHIND_METERS),
    junctionRouteMeters,
  );
  if (traveledCoords.length >= 1) {
    traveledCoords[traveledCoords.length - 1] = junctionCoord;
  }

  const futureCoords = extractRouteSlice(
    geometry,
    junctionRouteMeters,
    totalMeters,
  );
  if (futureCoords.length >= 1) {
    futureCoords[0] = junctionCoord;
  } else {
    futureCoords.push(junctionCoord);
    const tail = extractRouteSlice(
      geometry,
      junctionRouteMeters + 0.05,
      totalMeters,
    );
    for (const coord of tail) {
      pushPosition(futureCoords, coord);
    }
  }

  let futureGlow: Feature<LineString> | null = null;
  const glowRouteMeters =
    anchorRouteMeters +
    NAV_ARROW_TIP_AHEAD_METERS +
    FUTURE_GLOW_EXTRA_AHEAD_METERS;
  const glowCoords = extractRouteSlice(geometry, glowRouteMeters, totalMeters);
  if (glowCoords.length >= 2) {
    futureGlow = lineFeature(glowCoords);
  }

  return {
    anchor,
    segmentIndex,
    junctionRouteMeters,
    forwardBearing: forwardBearingFromAnchor(geometry, anchor, anchorRouteMeters),
    traveled: traveledCoords.length >= 2 ? lineFeature(traveledCoords) : null,
    future:
      futureCoords.length >= 2
        ? lineFeature(futureCoords)
        : lineFeature([]),
    futureGlow,
  };
}

/** iOS requires >= 2 coordinates; fall back to full route when split future is empty. */
export function resolveNavigationFutureShape(
  splitFuture: Feature<LineString>,
  fullGeometry: Feature<LineString>,
): Feature<LineString> {
  if (splitFuture.geometry.coordinates.length >= 2) return splitFuture;
  if (fullGeometry.geometry.coordinates.length >= 2) return fullGeometry;
  return splitFuture;
}

export function routeLineWidths(screenWidth: number) {
  const width = routeLineWidthExpression(screenWidth, ROUTE_LINE_WIDTH_RATIO);
  return {
    future: width,
    futureGlow: routeLineWidthExpression(screenWidth, ROUTE_GLOW_WIDTH_RATIO),
    traveled: width,
  };
}

export function routeLineWidthPx(
  screenWidth: number,
  widthRatio: number,
): number {
  return Math.max(7, Math.round(screenWidth * widthRatio));
}

export type MapboxZoomLineWidth = readonly (string | number | readonly string[])[];

export function routeLineWidthExpression(
  screenWidth: number,
  widthRatio: number,
): MapboxZoomLineWidth {
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
    base,
  ];
}
