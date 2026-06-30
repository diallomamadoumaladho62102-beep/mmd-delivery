import type { Feature, LineString } from "geojson";
import {
  iconCenterAheadFromAnchorMeters,
  NAV_ROUTE_ICON_LEAD_METERS,
  junctionRouteMetersFromTraveled,
} from "./driverNavigationVisual";
import {
  pointAtRouteDistance,
  splitNavigationRoute,
} from "./driverNavigationRouteStyle";
import { distanceMeters } from "./coordinates";

function straightRoute(lengthMeters: number): Feature<LineString> {
  const coords: [number, number][] = [];
  const steps = 20;
  for (let i = 0; i <= steps; i += 1) {
    coords.push([0, i * (lengthMeters / steps) * 0.000009]);
  }
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: coords },
  };
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const route = straightRoute(800);
const traveledMeters = 120;
const junctionRouteMeters = junctionRouteMetersFromTraveled(traveledMeters);

const split = splitNavigationRoute(route, traveledMeters);
assert(split != null, "split should exist");

const junction = pointAtRouteDistance(route, junctionRouteMeters)?.point;
assert(junction != null, "junction point should exist");

const greenEnd = split!.traveled?.geometry.coordinates.at(-1);
const cyanStart = split!.future.geometry.coordinates[0];
assert(greenEnd != null, "green end should exist");
assert(cyanStart != null, "cyan start should exist");

assert(
  Math.abs(greenEnd![0] - junction!.longitude) < 1e-8 &&
    Math.abs(greenEnd![1] - junction!.latitude) < 1e-8,
  "green must end at junction center",
);
assert(
  Math.abs(cyanStart[0] - junction!.longitude) < 1e-8 &&
    Math.abs(cyanStart[1] - junction!.latitude) < 1e-8,
  "cyan must start at junction center",
);

const anchor = pointAtRouteDistance(
  route,
  traveledMeters + NAV_ROUTE_ICON_LEAD_METERS,
)!.point;
const cyanStartDistFromAnchor = distanceMeters(
  anchor.latitude,
  anchor.longitude,
  cyanStart[1],
  cyanStart[0],
);
assert(
  cyanStartDistFromAnchor + 0.05 >= iconCenterAheadFromAnchorMeters(),
  "cyan must start at icon center ahead of anchor, not behind the vehicle",
);

console.log("driverNavigationRouteStyle.test.ts OK");
