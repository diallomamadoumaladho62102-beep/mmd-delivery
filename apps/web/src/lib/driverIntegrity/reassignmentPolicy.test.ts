import assert from "node:assert/strict";
import test from "node:test";
import { cloneDefaultSettings } from "./engineGate";
import {
  doubleAssignmentForbidden,
  evaluateReassignmentEligibility,
  reassignmentMustPreserveHistory,
} from "./reassignmentPolicy";
import type { AssignmentSnapshot, ProgressSignals } from "./types";

function assignment(over: Partial<AssignmentSnapshot> = {}): AssignmentSnapshot {
  return {
    entityType: "order",
    entityId: "11111111-1111-1111-1111-111111111111",
    driverId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    status: "dispatched",
    driverAcceptedAt: "2026-10-01T12:00:00.000Z",
    pickedUpAt: null,
    deliveredAt: null,
    cancelledAt: null,
    alreadyReassigned: false,
    ...over,
  };
}

function signals(over: Partial<ProgressSignals> = {}): ProgressSignals {
  return {
    driverAcceptedAtMs: Date.parse("2026-10-01T12:00:00.000Z"),
    nowMs: Date.parse("2026-10-01T12:05:00.000Z"),
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

const settings = {
  ...cloneDefaultSettings(),
  monitoringEnabled: true,
  reassignmentEnabled: true,
  driverNoProgressReassignmentAfterSeconds: 120,
};

const expected = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

test("reassignment requires warning, flags, and no progress", () => {
  const ok = evaluateReassignmentEligibility({
    settings,
    signals: signals(),
    assignment: assignment(),
    expectedDriverId: expected,
    firstWarningAtMs: Date.parse("2026-10-01T12:01:00.000Z"),
  });
  assert.equal(ok.ok, true);
});

test("already picked up / delivered / cancelled are blocked", () => {
  assert.equal(
    evaluateReassignmentEligibility({
      settings,
      signals: signals(),
      assignment: assignment({ pickedUpAt: "2026-10-01T12:03:00.000Z" }),
      expectedDriverId: expected,
      firstWarningAtMs: 1,
    }).ok,
    false
  );
  const delivered = evaluateReassignmentEligibility({
    settings,
    signals: signals(),
    assignment: assignment({ deliveredAt: "2026-10-01T12:04:00.000Z" }),
    expectedDriverId: expected,
    firstWarningAtMs: 1,
  });
  assert.equal(delivered.ok, false);
  if (delivered.ok === false) assert.equal(delivered.reason, "already_delivered");
  const cancelled = evaluateReassignmentEligibility({
    settings,
    signals: signals(),
    assignment: assignment({ cancelledAt: "2026-10-01T12:04:00.000Z" }),
    expectedDriverId: expected,
    firstWarningAtMs: 1,
  });
  assert.equal(cancelled.ok, false);
  if (cancelled.ok === false) assert.equal(cancelled.reason, "already_cancelled");
});

test("double assignment is forbidden", () => {
  assert.equal(
    doubleAssignmentForbidden(expected, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
    true
  );
  assert.equal(doubleAssignmentForbidden(expected, expected), false);
});

test("reassignment never erases official trip history or earnings", () => {
  const preserved = reassignmentMustPreserveHistory();
  assert.equal(preserved.eraseDriverAcceptedAt, false);
  assert.equal(preserved.eraseOfficialTripHistory, false);
  assert.equal(preserved.deleteAdmissibleTime, false);
  assert.equal(preserved.deleteDueEarnings, false);
  assert.equal(preserved.modifyMinimumPayEngine, false);
});

test("driver mismatch and concurrent stale state are blocked", () => {
  const mismatch = evaluateReassignmentEligibility({
    settings,
    signals: signals(),
    assignment: assignment({ driverId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }),
    expectedDriverId: expected,
    firstWarningAtMs: 1,
  });
  assert.equal(mismatch.ok, false);
  if (mismatch.ok === false) assert.equal(mismatch.reason, "driver_mismatch");
  const already = evaluateReassignmentEligibility({
    settings,
    signals: signals(),
    assignment: assignment({ alreadyReassigned: true }),
    expectedDriverId: expected,
    firstWarningAtMs: 1,
  });
  assert.equal(already.ok, false);
  if (already.ok === false) assert.equal(already.reason, "already_reassigned");
});

test("legitimate restaurant wait / reported issue blocks reassignment", () => {
  const legit = evaluateReassignmentEligibility({
    settings,
    signals: signals({ waitReasonCode: "restaurant_delay" }),
    assignment: assignment(),
    expectedDriverId: expected,
    firstWarningAtMs: 1,
  });
  assert.equal(legit.ok, false);
  if (legit.ok === false) assert.equal(legit.reason, "legitimate_reason_recorded");
});
