import assert from "node:assert/strict";
import {
  getMultiLegDistanceAndDuration,
  isValidCoordinate,
  resolveTaxiMultiStopRoute,
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

async function testMultiStopQuoteUsesEveryCoordinate() {
  const env = process.env as Record<string, string | undefined>;
  const prevToken = env.MAPBOX_ACCESS_TOKEN;
  const prevFetch = globalThis.fetch;
  let requested = "";
  try {
    env.MAPBOX_ACCESS_TOKEN = "pk.test";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested = String(input);
      return new Response(
        JSON.stringify({ routes: [{ distance: 16093.4, duration: 1800 }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const route = await resolveTaxiMultiStopRoute({
      pickupAddress: "Pickup",
      dropoffAddress: "Dropoff",
      pickupLat: 40.65,
      pickupLng: -73.95,
      dropoffLat: 40.7,
      dropoffLng: -73.9,
      stops: [
        { address: "Stop 1", lat: 40.66, lng: -73.94 },
        { address: "Stop 2", lat: 40.68, lng: -73.92 },
      ],
    });

    assert.match(
      requested,
      /-73\.95,40\.65;-73\.94,40\.66;-73\.92,40\.68;-73\.9,40\.7/,
    );
    assert.deepEqual(
      route.stops.map((stop) => `${stop.stopOrder}:${stop.address}`),
      ["1:Stop 1", "2:Stop 2"],
    );
    assert.equal(route.distanceMiles, 16093.4 / 1609.34);
    assert.equal(route.durationMinutes, 30);
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
  await testMultiStopQuoteUsesEveryCoordinate();
  console.log("taxiMapbox.test.ts OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
