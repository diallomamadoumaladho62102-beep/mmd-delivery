import assert from "node:assert/strict";
import type { Feature, LineString } from "geojson";
import { resolveNavigationFutureShape } from "./driverNavigationRouteStyle";

function line(coords: [number, number][]): Feature<LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: coords },
  };
}

const full = line([
  [0, 0],
  [0, 0.001],
  [0, 0.002],
]);
const empty = line([]);

assert.equal(
  resolveNavigationFutureShape(empty, full).geometry.coordinates.length,
  3,
  "falls back to full route when split future is empty",
);

assert.equal(
  resolveNavigationFutureShape(full, empty).geometry.coordinates.length,
  3,
  "keeps split future when valid",
);

console.log("driverNavigationRouteLayers.test.ts OK");
