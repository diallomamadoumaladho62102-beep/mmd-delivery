import assert from "node:assert/strict";
import {
  buildMultiStopQuoteNavigationParams,
  MAX_TAXI_STOPS,
  normalizeOrderedStops,
  reorderStops,
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

function testMaxStopsCapped() {
  const many = Array.from({ length: MAX_TAXI_STOPS + 3 }, (_, i) => `Stop ${i + 1}`);
  const stops = normalizeOrderedStops(many);
  assert.equal(stops.length, MAX_TAXI_STOPS);
}

function testReorderStops() {
  const stops = ["A", "B", "C", "D"];
  assert.deepEqual(reorderStops(stops, 0, 2), ["B", "C", "A", "D"]);
  assert.deepEqual(reorderStops(stops, 3, 1), ["A", "D", "B", "C"]);
  assert.deepEqual(reorderStops(stops, 1, 1), ["A", "B", "C", "D"]);
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
testMaxStopsCapped();
testReorderStops();
testQuoteBeforeCreateInvariant();
testBuildNavParams();

console.log("taxiMultiStopFlow.test.ts OK");
