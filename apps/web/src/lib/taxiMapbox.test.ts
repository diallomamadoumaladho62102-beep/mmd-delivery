import assert from "node:assert/strict";
import { isValidCoordinate, ROUTE_UNAVAILABLE } from "./taxiMapbox";

function testValidCoordinates() {
  assert.equal(isValidCoordinate(40.65, -73.95), true);
  assert.equal(isValidCoordinate(-90, 180), true);
}

function testInvalidCoordinates() {
  assert.equal(isValidCoordinate(null, null), false);
  assert.equal(isValidCoordinate(undefined, undefined), false);
  assert.equal(isValidCoordinate(91, 0), false);
  assert.equal(isValidCoordinate(0, 181), false);
  assert.equal(isValidCoordinate(0, 0), false);
  assert.equal(isValidCoordinate("abc", "def"), false);
}

function testRouteUnavailableConstant() {
  assert.equal(ROUTE_UNAVAILABLE, "route_unavailable");
}

testValidCoordinates();
testInvalidCoordinates();
testRouteUnavailableConstant();

console.log("taxiMapbox.test.ts OK");
