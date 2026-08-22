import assert from "node:assert/strict";
import { isValidCoordinate, toCoordinatePoint } from "./coordinates";

assert.equal(isValidCoordinate(40.7128, -74.006), true);
assert.equal(isValidCoordinate(0, 0), false, "null island rejected");
assert.equal(isValidCoordinate(null, null), false);
assert.equal(isValidCoordinate(91, 0), false);
assert.equal(isValidCoordinate(0, 181), false);

assert.deepEqual(toCoordinatePoint(40.7, -73.9), {
  latitude: 40.7,
  longitude: -73.9,
});
assert.equal(toCoordinatePoint(0, 0), null);

console.log("coordinates.test.ts OK");
