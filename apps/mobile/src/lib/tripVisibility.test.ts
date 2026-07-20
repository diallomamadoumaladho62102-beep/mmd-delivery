import assert from "node:assert/strict";
import { isLiveVisibleTrip } from "./tripVisibility";

function testLiveTrip() {
  assert.equal(
    isLiveVisibleTrip({
      is_test: false,
      hidden_from_user: false,
      archived_at: null,
    }),
    true,
  );
  assert.equal(
    isLiveVisibleTrip({
      is_test: false,
      hidden_from_user: null,
      archived_at: null,
    }),
    true,
  );
}

function testTestTrip() {
  assert.equal(
    isLiveVisibleTrip({
      is_test: true,
      hidden_from_user: false,
      archived_at: null,
    }),
    false,
  );
}

function testHiddenTrip() {
  assert.equal(
    isLiveVisibleTrip({
      is_test: false,
      hidden_from_user: true,
      archived_at: null,
    }),
    false,
  );
}

function testArchivedTrip() {
  assert.equal(
    isLiveVisibleTrip({
      is_test: false,
      hidden_from_user: false,
      archived_at: "2026-01-01T00:00:00.000Z",
    }),
    false,
  );
}

function testNullRow() {
  assert.equal(isLiveVisibleTrip(null), false);
  assert.equal(isLiveVisibleTrip(undefined), false);
}

testLiveTrip();
testTestTrip();
testHiddenTrip();
testArchivedTrip();
testNullRow();

console.log("tripVisibility.test.ts OK");
