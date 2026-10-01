import assert from "node:assert/strict";
import test from "node:test";
import { tripInConfiguredJurisdiction } from "./nycGeo";

test("empty Admin county list is fail-closed", () => {
  const result = tripInConfiguredJurisdiction({
    pickupLat: 40.7128,
    pickupLng: -74.006,
    dropoffLat: 40.758,
    dropoffLng: -73.9855,
    eligibleCountyCodes: [],
  });
  assert.equal(result.eligible, false);
  assert.equal(result.pickupInScope, false);
  assert.equal(result.dropoffInScope, false);
});

test("eligibility is pickup OR dropoff in configured counties", () => {
  const bothOut = tripInConfiguredJurisdiction({
    pickupLat: null,
    pickupLng: null,
    dropoffLat: null,
    dropoffLng: null,
    eligibleCountyCodes: ["36061"],
  });
  assert.equal(bothOut.eligible, false);
});
