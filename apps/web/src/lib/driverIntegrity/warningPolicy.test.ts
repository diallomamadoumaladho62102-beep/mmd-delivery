import assert from "node:assert/strict";
import test from "node:test";
import { cloneDefaultSettings } from "./engineGate";
import { decideWarningAction } from "./warningPolicy";
import type { ProgressSignals } from "./types";

function signals(over: Partial<ProgressSignals> = {}): ProgressSignals {
  return {
    driverAcceptedAtMs: 0,
    nowMs: 180_000,
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

const enabled = {
  ...cloneDefaultSettings(),
  monitoringEnabled: true,
  warningNotificationsEnabled: true,
  reassignmentEnabled: true,
  reviewEnabled: true,
  driverAcceptanceWarningAfterSeconds: 60,
  driverNoProgressReassignmentAfterSeconds: 180,
  driverNoProgressReviewAfterSeconds: 600,
  movementProgressThresholdMeters: 40,
};

const noneHistory = {
  firstWarningAtMs: null,
  finalWarningAtMs: null,
  reassignedAtMs: null,
  reviewOpenedAtMs: null,
};

test("flags off: no automatic warning", () => {
  const decision = decideWarningAction({
    settings: cloneDefaultSettings(),
    signals: signals(),
    history: noneHistory,
  });
  assert.equal(decision.action, "none");
});

test("no progress after accept sends first warning once", () => {
  const decision = decideWarningAction({
    settings: enabled,
    signals: signals({ nowMs: 90_000 }),
    history: noneHistory,
  });
  assert.equal(decision.action, "first_warning");
});

test("progress after warning blocks reassignment", () => {
  const decision = decideWarningAction({
    settings: enabled,
    signals: signals({ arrivedAtMs: 50_000, nowMs: 200_000 }),
    history: { ...noneHistory, firstWarningAtMs: 70_000 },
  });
  assert.equal(decision.action, "none");
  assert.equal(decision.reason, "valid_progress");
});

test("duplicate first warning is not emitted", () => {
  const decision = decideWarningAction({
    settings: enabled,
    signals: signals({ nowMs: 90_000 }),
    history: { ...noneHistory, firstWarningAtMs: 61_000 },
  });
  assert.notEqual(decision.action, "first_warning");
});

test("second timeout sends final warning before reassignment", () => {
  const decision = decideWarningAction({
    settings: enabled,
    signals: signals({ nowMs: 200_000 }),
    history: { ...noneHistory, firstWarningAtMs: 70_000 },
  });
  assert.equal(decision.action, "final_warning");
});

test("after final warning, no progress triggers reassignment", () => {
  const decision = decideWarningAction({
    settings: enabled,
    signals: signals({ nowMs: 200_000 }),
    history: {
      ...noneHistory,
      firstWarningAtMs: 70_000,
      finalWarningAtMs: 180_000,
    },
  });
  assert.equal(decision.action, "reassign");
});

test("driver reported legitimate issue blocks reassignment", () => {
  const decision = decideWarningAction({
    settings: enabled,
    signals: signals({ waitReasonCode: "traffic", nowMs: 200_000 }),
    history: {
      ...noneHistory,
      firstWarningAtMs: 70_000,
      finalWarningAtMs: 180_000,
    },
  });
  assert.equal(decision.action, "none");
  assert.equal(decision.reason, "legitimate_reason_recorded");
});

test("picked up or cancelled never reassign", () => {
  assert.equal(
    decideWarningAction({
      settings: enabled,
      signals: signals({ pickedUpAtMs: 10_000 }),
      history: noneHistory,
    }).action,
    "none"
  );
  assert.equal(
    decideWarningAction({
      settings: enabled,
      signals: signals({ cancelledAtMs: 10_000 }),
      history: noneHistory,
    }).reason,
    "terminal_state"
  );
});
