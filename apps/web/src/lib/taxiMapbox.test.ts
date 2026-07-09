import assert from "node:assert/strict";
import {
  getMultiLegDistanceAndDuration,
  isValidCoordinate,
  ROUTE_UNAVAILABLE,
} from "./taxiMapbox";

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

async function testDirectionsFailClosed() {
  const env = process.env as Record<string, string | undefined>;
  const prevToken = env.MAPBOX_ACCESS_TOKEN;
  const prevFetch = globalThis.fetch;
  try {
    env.MAPBOX_ACCESS_TOKEN = "pk.test";
    globalThis.fetch = (async () =>
      new Response("upstream error", { status: 503 })) as typeof fetch;
    await assert.rejects(
      () =>
        getMultiLegDistanceAndDuration([
          { lat: 40.65, lng: -73.95 },
          { lat: 40.7, lng: -73.9 },
        ]),
      (err: unknown) =>
        err instanceof Error && err.message === ROUTE_UNAVAILABLE
    );
  } finally {
    globalThis.fetch = prevFetch;
    if (prevToken == null) delete env.MAPBOX_ACCESS_TOKEN;
    else env.MAPBOX_ACCESS_TOKEN = prevToken;
  }
}

async function main() {
  testValidCoordinates();
  testInvalidCoordinates();
  testRouteUnavailableConstant();
  await testDirectionsFailClosed();
  console.log("taxiMapbox.test.ts OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
