import assert from "node:assert/strict";
import {
  collectLiveTripCameraPoints,
  getCameraForLngLatPoints,
  resolveEtaEndpoints,
  straightLineGeometry,
} from "./liveTripTracking";

function testPointsWithoutDriver() {
  const points = collectLiveTripCameraPoints({
    pickup: { latitude: 40.7, longitude: -74.0 },
    dropoff: { latitude: 40.71, longitude: -73.99 },
  });
  assert.equal(points.length, 2);
  assert.deepEqual(points[0], [-74.0, 40.7]);
}

function testPointsWithDriver() {
  const points = collectLiveTripCameraPoints({
    pickup: { latitude: 40.7, longitude: -74.0 },
    dropoff: { latitude: 40.71, longitude: -73.99 },
    driver: { latitude: 40.705, longitude: -73.995 },
  });
  assert.equal(points.length, 3);
  assert.deepEqual(points[2], [-73.995, 40.705]);
}

function testCameraDefaults() {
  const empty = getCameraForLngLatPoints([]);
  assert.equal(empty.zoomLevel, 11);
  const one = getCameraForLngLatPoints([[-74, 40.7]]);
  assert.equal(one.zoomLevel, 14);
}

function testStraightLine() {
  const geo = straightLineGeometry(
    { latitude: 1, longitude: 2 },
    { latitude: 3, longitude: 4 }
  );
  assert.equal(geo.geometry.type, "LineString");
  assert.deepEqual(geo.geometry.coordinates, [
    [2, 1],
    [4, 3],
  ]);
}

function testEtaEndpoints() {
  const pickup = { latitude: 40.7, longitude: -74 };
  const dropoff = { latitude: 40.8, longitude: -73.9 };
  const driver = { latitude: 40.75, longitude: -73.95 };

  const before = resolveEtaEndpoints({
    status: "accepted",
    pickup,
    dropoff,
    driver,
  });
  assert.deepEqual(before.from, driver);
  assert.deepEqual(before.to, pickup);

  const mid = resolveEtaEndpoints({
    status: "in_progress",
    pickup,
    dropoff,
    driver,
  });
  assert.deepEqual(mid.from, driver);
  assert.deepEqual(mid.to, dropoff);

  const noDriver = resolveEtaEndpoints({
    status: "paid",
    pickup,
    dropoff,
  });
  assert.deepEqual(noDriver.from, pickup);
  assert.deepEqual(noDriver.to, dropoff);
}

testPointsWithoutDriver();
testPointsWithDriver();
testCameraDefaults();
testStraightLine();
testEtaEndpoints();

console.log("liveTripTracking.test.ts OK");
