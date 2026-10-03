import assert from "node:assert/strict";
import test from "node:test";
import {
  canAutomaticallyTransferMinimumPayKind,
  canRecordMinimumPayEvents,
  canTransferMinimumPayAdjustments,
  engineHasStarted,
  fleetAllocationRequiresManualApproval,
  isTimestampOnOrAfterStart,
  settingsAreCompleteForPeriods,
} from "./engineGate";
import type { MinimumPayEngineSettings } from "./types";

function settings(
  patch: Partial<MinimumPayEngineSettings>
): MinimumPayEngineSettings {
  return {
    mode: "off",
    engineStartAt: null,
    timezone: null,
    periodLengthDays: null,
    periodStartWeekday: null,
    defaultJurisdiction: null,
    defaultCurrency: null,
    defaultMethod: null,
    defaultRounding: null,
    eligibleCountyCodes: [],
    eligibleSourceTypes: [],
    excludedSourceTypes: [],
    waitFeeCounts: false,
    bonusCounts: false,
    transfersEnabled: false,
    onCallStaleAfterSeconds: null,
    requireChangeReason: true,
    ...patch,
  };
}

test("no recording before engine_start_at", () => {
  const start = "2000-06-01T00:00:00.000Z";
  const cfg = settings({ mode: "shadow", engineStartAt: start });
  assert.equal(engineHasStarted(cfg, Date.parse("2000-05-31T23:59:59.000Z")), false);
  assert.equal(canRecordMinimumPayEvents(cfg, Date.parse("2000-05-31T23:59:59.000Z")), false);
  assert.equal(isTimestampOnOrAfterStart(cfg, "2000-05-01T00:00:00.000Z"), false);
});

test("recording starts at configured activation", () => {
  const start = "2000-06-01T00:00:00.000Z";
  const cfg = settings({ mode: "shadow", engineStartAt: start });
  assert.equal(canRecordMinimumPayEvents(cfg, Date.parse(start)), true);
});

test("off mode never records or transfers", () => {
  const start = "2000-06-01T00:00:00.000Z";
  const cfg = settings({ mode: "off", engineStartAt: start, transfersEnabled: true });
  assert.equal(canRecordMinimumPayEvents(cfg, Date.parse(start) + 1000), false);
  assert.equal(canTransferMinimumPayAdjustments(cfg, Date.parse(start) + 1000), false);
});

test("shadow never transfers even when transfers_enabled", () => {
  const start = "2000-06-01T00:00:00.000Z";
  const cfg = settings({
    mode: "shadow",
    engineStartAt: start,
    transfersEnabled: true,
  });
  assert.equal(canTransferMinimumPayAdjustments(cfg, Date.parse(start) + 1000), false);
});

test("active still requires transfers_enabled", () => {
  const start = "2000-06-01T00:00:00.000Z";
  const cfg = settings({ mode: "active", engineStartAt: start, transfersEnabled: false });
  assert.equal(canTransferMinimumPayAdjustments(cfg, Date.parse(start) + 1000), false);
});

test("active + transfers_enabled can transfer after start", () => {
  const start = "2000-06-01T00:00:00.000Z";
  const cfg = settings({ mode: "active", engineStartAt: start, transfersEnabled: true });
  assert.equal(canTransferMinimumPayAdjustments(cfg, Date.parse(start) + 1000), true);
  assert.equal(canAutomaticallyTransferMinimumPayKind("individual"), true);
  assert.equal(canAutomaticallyTransferMinimumPayKind("fleet_allocation"), false);
  assert.equal(fleetAllocationRequiresManualApproval("fleet_allocation"), true);
  assert.equal(fleetAllocationRequiresManualApproval("individual"), false);
});

test("accept after engine_start records; accept before does not", () => {
  const start = "2000-06-01T12:00:00.000Z";
  const cfg = settings({ mode: "shadow", engineStartAt: start });
  assert.equal(isTimestampOnOrAfterStart(cfg, "2000-06-01T11:59:00.000Z"), false);
  assert.equal(isTimestampOnOrAfterStart(cfg, "2000-06-01T12:00:00.000Z"), true);
  assert.equal(isTimestampOnOrAfterStart({ engineStartAt: null }, "2000-06-01T13:00:00.000Z"), false);
});

test("period settings require period_start_weekday from Admin", () => {
  const base = {
    engineStartAt: "2000-06-01T00:00:00.000Z",
    timezone: "America/New_York",
    periodLengthDays: 7,
    defaultJurisdiction: "nyc",
    defaultMethod: "standard",
    defaultRounding: "ceil_cents",
  };
  assert.equal(settingsAreCompleteForPeriods(settings(base)), false);
  assert.equal(settingsAreCompleteForPeriods(settings({ ...base, periodStartWeekday: 1 })), true);
});
