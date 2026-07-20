import assert from "node:assert/strict";
import {
  isLiveVisibleTrip,
  shouldIncludeTestTrips,
} from "./tripVisibility";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("isLiveVisibleTrip rejects null/undefined rows", () => {
  assert.equal(isLiveVisibleTrip(null), false);
  assert.equal(isLiveVisibleTrip(undefined), false);
});

test("isLiveVisibleTrip accepts clean production rows", () => {
  assert.equal(isLiveVisibleTrip({}), true);
  assert.equal(
    isLiveVisibleTrip({ is_test: false, hidden_from_user: false, archived_at: null }),
    true
  );
});

test("isLiveVisibleTrip rejects test, hidden, and archived rows", () => {
  assert.equal(isLiveVisibleTrip({ is_test: true }), false);
  assert.equal(isLiveVisibleTrip({ hidden_from_user: true }), false);
  assert.equal(isLiveVisibleTrip({ archived_at: "2026-01-01T00:00:00.000Z" }), false);
});

test("shouldIncludeTestTrips defaults to false", () => {
  assert.equal(shouldIncludeTestTrips(new URLSearchParams()), false);
  assert.equal(shouldIncludeTestTrips(new URLSearchParams("include_test=0")), false);
});

test("shouldIncludeTestTrips accepts explicit truthy values", () => {
  assert.equal(shouldIncludeTestTrips(new URLSearchParams("include_test=1")), true);
  assert.equal(shouldIncludeTestTrips(new URLSearchParams("include_test=true")), true);
  assert.equal(shouldIncludeTestTrips(new URLSearchParams("include_test=yes")), true);
  assert.equal(
    shouldIncludeTestTrips(new URLSearchParams("include_test=TRUE")),
    true
  );
});
