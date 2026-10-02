import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyIntegrityCase,
  hasLegitimateReportedReason,
  hasValidProgress,
} from "./progress";
import type { ProgressSignals } from "./types";

function base(over: Partial<ProgressSignals> = {}): ProgressSignals {
  return {
    driverAcceptedAtMs: 1_000,
    nowMs: 1_000 + 120_000,
    arrivedAtMs: null,
    waitTimerStartedAtMs: null,
    pickedUpAtMs: null,
    deliveredAtMs: null,
    cancelledAtMs: null,
    locationUpdatedAtMs: null,
    metersFromAccept: null,
    gpsAvailable: false,
    gpsStale: false,
    waitReasonCode: null,
    ...over,
  };
}

test("driver accept with no later events is not valid progress", () => {
  assert.equal(hasValidProgress(base(), 50), false);
  assert.equal(classifyIntegrityCase(base(), 50), "gps_unavailable");
});

test("GPS unavailable is a case, never automatic fraud progress requirement", () => {
  assert.equal(classifyIntegrityCase(base({ gpsAvailable: false }), 50), "gps_unavailable");
});

test("arrival or wait timer is valid progress without GPS", () => {
  const arrived = base({ arrivedAtMs: 2_000, gpsAvailable: false });
  assert.equal(hasValidProgress(arrived, 50), true);
  assert.equal(classifyIntegrityCase(arrived, 50), "arrived_no_pickup");
});

test("pickup is valid progress", () => {
  assert.equal(hasValidProgress(base({ pickedUpAtMs: 3_000 }), 50), true);
});

test("GPS movement above threshold is valid progress", () => {
  const moving = base({
    gpsAvailable: true,
    metersFromAccept: 120,
  });
  assert.equal(hasValidProgress(moving, 50), true);
  assert.equal(classifyIntegrityCase(moving, 50), "moving_not_arrived");
});

test("small GPS jitter below threshold is not progress", () => {
  const jitter = base({ gpsAvailable: true, metersFromAccept: 8 });
  assert.equal(hasValidProgress(jitter, 50), false);
  assert.equal(classifyIntegrityCase(jitter, 50), "no_movement");
});

test("restaurant delay reason is legitimate and does not count as GPS fraud", () => {
  const delayed = base({ waitReasonCode: "restaurant_delay", arrivedAtMs: 2_000 });
  assert.equal(hasLegitimateReportedReason(delayed.waitReasonCode), true);
  assert.equal(classifyIntegrityCase(delayed, 50), "restaurant_delay");
});
