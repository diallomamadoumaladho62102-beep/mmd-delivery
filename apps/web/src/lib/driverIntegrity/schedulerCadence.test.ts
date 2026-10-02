import assert from "node:assert/strict";
import test from "node:test";
import { decideWarningAction } from "./warningPolicy";
import { failClosedScanSkipReason } from "./engineGate";
import { DEFAULT_DRIVER_INTEGRITY_SETTINGS } from "./types";
import {
  DRIVER_INTEGRITY_CRON_EXPRESSION,
  DRIVER_INTEGRITY_LOCK_TTL_SECONDS,
  GITHUB_ACTIONS_MIN_SCHEDULE_MINUTES,
  isSupportedGithubActionsSchedule,
  lockTtlFitsSchedule,
} from "./schedulerCadence";

const settingsOn = {
  ...DEFAULT_DRIVER_INTEGRITY_SETTINGS,
  monitoringEnabled: true,
  warningNotificationsEnabled: true,
  driverAcceptanceWarningAfterSeconds: 90,
  engineStartAt: "2026-10-02T00:00:00.000Z",
};

function signals(elapsedSeconds: number) {
  const accepted = Date.parse("2026-01-01T00:00:00.000Z");
  return {
    driverAcceptedAtMs: accepted,
    nowMs: accepted + elapsedSeconds * 1000,
    arrivedAtMs: null,
    waitTimerStartedAtMs: null,
    pickedUpAtMs: null,
    deliveredAtMs: null,
    cancelledAtMs: null,
    locationUpdatedAtMs: null,
    metersFromAccept: 0,
    gpsAvailable: true,
    gpsStale: false,
    waitReasonCode: null,
  };
}

test("GitHub Actions rejects sub-5-minute schedules", () => {
  assert.equal(GITHUB_ACTIONS_MIN_SCHEDULE_MINUTES, 5);
  assert.equal(isSupportedGithubActionsSchedule("*/1 * * * *"), false);
  assert.equal(isSupportedGithubActionsSchedule("*/2 * * * *"), false);
  assert.equal(isSupportedGithubActionsSchedule("*/4 * * * *"), false);
  assert.equal(isSupportedGithubActionsSchedule("*/5 * * * *"), true);
  assert.equal(DRIVER_INTEGRITY_CRON_EXPRESSION, "*/5 * * * *");
});

test("lock TTL expires before the next supported tick", () => {
  assert.ok(lockTtlFitsSchedule(DRIVER_INTEGRITY_LOCK_TTL_SECONDS, 5));
  assert.equal(lockTtlFitsSchedule(300, 5), false);
  assert.equal(lockTtlFitsSchedule(0, 5), false);
});

test("flags OFF remain a no-op regardless of cadence", () => {
  assert.ok(failClosedScanSkipReason(DEFAULT_DRIVER_INTEGRITY_SETTINGS));
  assert.equal(failClosedScanSkipReason(settingsOn), null);
});

test("warning fires from server elapsed time, not from the cron interval", () => {
  const history = {
    firstWarningAtMs: null,
    finalWarningAtMs: null,
    reassignedAtMs: null,
    reviewOpenedAtMs: null,
  };
  assert.equal(
    decideWarningAction({ settings: settingsOn, signals: signals(60), history }).action,
    "none"
  );
  assert.equal(
    decideWarningAction({ settings: settingsOn, signals: signals(90), history }).action,
    "first_warning"
  );
  const alreadyWarned = decideWarningAction({
    settings: settingsOn,
    signals: signals(400),
    history: { ...history, firstWarningAtMs: Date.parse("2026-01-01T00:01:30.000Z") },
  });
  assert.notEqual(alreadyWarned.action, "first_warning");
});
