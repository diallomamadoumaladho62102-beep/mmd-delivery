import type { CoordinatePoint } from "./coordinates";
import { isValidCoordinate } from "./coordinates";

export type TripMapPoint = {
  longitude: number;
  latitude: number;
  role: "pickup" | "dropoff" | "driver" | "stop";
};

export type CameraPointsInput = {
  pickup?: CoordinatePoint | null;
  dropoff?: CoordinatePoint | null;
  driver?: CoordinatePoint | null;
  stops?: Array<CoordinatePoint | null | undefined>;
};

function toLngLat(point: CoordinatePoint): [number, number] {
  return [point.longitude, point.latitude];
}

/**
 * Collect [lng, lat] points for camera fit.
 * Includes driver when present; otherwise pickup/dropoff/stops only.
 */
export function collectLiveTripCameraPoints(
  input: CameraPointsInput
): [number, number][] {
  const points: [number, number][] = [];

  if (input.pickup && isValidCoordinate(input.pickup.latitude, input.pickup.longitude)) {
    points.push(toLngLat(input.pickup));
  }
  if (input.dropoff && isValidCoordinate(input.dropoff.latitude, input.dropoff.longitude)) {
    points.push(toLngLat(input.dropoff));
  }
  for (const stop of input.stops ?? []) {
    if (stop && isValidCoordinate(stop.latitude, stop.longitude)) {
      points.push(toLngLat(stop));
    }
  }
  if (input.driver && isValidCoordinate(input.driver.latitude, input.driver.longitude)) {
    points.push(toLngLat(input.driver));
  }

  return points;
}

export function getCameraForLngLatPoints(points: [number, number][]): {
  centerCoordinate: [number, number];
  zoomLevel: number;
} {
  if (points.length === 0) {
    return { centerCoordinate: [-73.95, 40.65], zoomLevel: 11 };
  }
  if (points.length === 1) {
    return { centerCoordinate: points[0], zoomLevel: 14 };
  }
  const lngs = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const delta = Math.max(maxLat - minLat, maxLng - minLng, 0.01);
  return {
    centerCoordinate: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
    zoomLevel: Math.max(10, Math.min(15, Math.log2(360 / (delta * 3.2)))),
  };
}

export function straightLineGeometry(
  from: CoordinatePoint,
  to: CoordinatePoint
): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: [
        [from.longitude, from.latitude],
        [to.longitude, to.latitude],
      ],
    },
  };
}

/**
 * ETA corridor: before pickup (accepted/arrived) → driver→pickup;
 * in transit → driver→dropoff; otherwise pickup→dropoff.
 */
export function resolveEtaEndpoints(params: {
  status?: string | null;
  pickup?: CoordinatePoint | null;
  dropoff?: CoordinatePoint | null;
  driver?: CoordinatePoint | null;
}): { from: CoordinatePoint | null; to: CoordinatePoint | null } {
  const status = String(params.status ?? "").toLowerCase();
  const toDropoff = params.dropoff ?? null;

  const enRouteToDropoff = [
    "picked_up",
    "in_progress",
    "out_for_delivery",
    "en_route",
  ].includes(status);

  const enRouteToPickup = [
    "accepted",
    "driver_arrived",
    "dispatched",
  ].includes(status);

  if (params.driver && enRouteToDropoff && toDropoff) {
    return { from: params.driver, to: toDropoff };
  }
  if (params.driver && enRouteToPickup && params.pickup) {
    return { from: params.driver, to: params.pickup };
  }
  if (params.driver && toDropoff) {
    return { from: params.driver, to: toDropoff };
  }
  return { from: params.pickup ?? params.driver ?? null, to: toDropoff };
}
