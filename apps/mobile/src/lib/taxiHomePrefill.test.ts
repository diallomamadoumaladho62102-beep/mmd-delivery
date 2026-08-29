import assert from "node:assert/strict";
import { taxiHomePrefillFromParams, taxiVehicleClassFromUnknown } from "./taxiHomePrefill";

assert.equal(taxiVehicleClassFromUnknown("comfort"), "comfort");
assert.equal(taxiVehicleClassFromUnknown("unknown"), null);

const prefill = taxiHomePrefillFromParams({
  pickupAddress: "123 Main Street",
  dropoffAddress: "JFK",
  pickupLat: 40.7,
  pickupLng: -73.9,
  vehicleClass: "xl",
  countryCode: "us",
});

assert.equal(prefill.pickup, "123 Main Street");
assert.equal(prefill.dropoff, "JFK");
assert.deepEqual(prefill.pickupCoords, { lat: 40.7, lng: -73.9 });
assert.equal(prefill.dropoffCoords, null);
assert.equal(prefill.vehicleClass, "xl");
assert.equal(prefill.countryCode, "US");

assert.equal(taxiHomePrefillFromParams(undefined).pickup, "");

console.log("taxiHomePrefill.test.ts OK");
