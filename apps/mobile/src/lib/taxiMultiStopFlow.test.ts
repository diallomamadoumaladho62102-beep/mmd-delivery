import assert from "node:assert/strict";
import {
  buildMultiStopQuoteNavigationParams,
  normalizeOrderedStops,
  shouldCreateRideBeforePayment,
} from "./taxiBookingFlow";

function testStopsOrderPreserved() {
  const stops = normalizeOrderedStops([
    "  Stop A  ",
    "",
    "Stop B",
    { address: "Stop C", lat: 1, lng: 2 },
  ]);
  assert.deepEqual(
    stops.map((s) => s.address),
    ["Stop A", "Stop B", "Stop C"]
  );
  assert.equal(stops[2].lat, 1);
  assert.equal(stops[2].lng, 2);
}

function testQuoteBeforeCreateInvariant() {
  assert.equal(shouldCreateRideBeforePayment(), false);
}

function testBuildNavParams() {
  const params = buildMultiStopQuoteNavigationParams({
    pickupAddress: "Pickup",
    dropoffAddress: "Dropoff",
    countryCode: "US",
    quote: { total_cents: 1000 },
    route: { distanceMiles: 3 },
    stops: ["Mid 1", "Mid 2"],
  });
  assert.equal(params.stops.length, 2);
  assert.equal(params.stops[0].address, "Mid 1");
  assert.equal(params.stops[1].address, "Mid 2");
  assert.equal(params.vehicleClass, "standard");
  assert.equal(shouldCreateRideBeforePayment(), false);
}

testStopsOrderPreserved();
testQuoteBeforeCreateInvariant();
testBuildNavParams();

console.log("taxiMultiStopFlow.test.ts OK");
