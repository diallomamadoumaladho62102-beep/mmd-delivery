import assert from "node:assert/strict";
import test from "node:test";
import {
  existingPeriodMustBePreserved,
  nextPeriodWindow,
  periodStartsOnOrAfterEngine,
  resolveOnCallEndedAt,
  shouldCreatePeriodWindow,
  windowsAreContiguous,
} from "./payPeriod";
import type { MinimumPayEngineSettings } from "./types";
import { zonedLocalToUtcMs } from "./zonedTime";

function settings(
  patch: Partial<MinimumPayEngineSettings>
): MinimumPayEngineSettings {
  return {
    mode: "shadow",
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

test("period_start_weekday is required and used", () => {
  const missing = nextPeriodWindow({
    settings: settings({
      engineStartAt: "2026-10-07T18:00:00.000Z",
      timezone: "America/New_York",
      periodLengthDays: 7,
    }),
  });
  assert.ok("error" in missing);
  assert.equal(missing.error, "period_start_weekday_required");
});

test("Monday period aligns the first end to the next Monday midnight", () => {
  const window = nextPeriodWindow({
    settings: settings({
      engineStartAt: "2026-10-07T18:00:00.000Z",
      timezone: "America/New_York",
      periodLengthDays: 7,
      periodStartWeekday: 1,
    }),
  });
  assert.ok(!("error" in window));
  assert.equal(window.startsAt, "2026-10-07T18:00:00.000Z");
  assert.equal(window.endsAt, "2026-10-12T04:00:00.000Z");
});

test("Tuesday period uses the configured weekday not Monday", () => {
  const window = nextPeriodWindow({
    settings: settings({
      engineStartAt: "2026-10-07T18:00:00.000Z",
      timezone: "America/New_York",
      periodLengthDays: 7,
      periodStartWeekday: 2,
    }),
  });
  assert.ok(!("error" in window));
  assert.equal(window.endsAt, "2026-10-13T04:00:00.000Z");
});

test("Wednesday period can be configured", () => {
  const window = nextPeriodWindow({
    settings: settings({
      engineStartAt: "2026-10-05T13:00:00.000Z",
      timezone: "America/New_York",
      periodLengthDays: 7,
      periodStartWeekday: 3,
    }),
  });
  assert.ok(!("error" in window));
  assert.equal(window.endsAt, "2026-10-07T04:00:00.000Z");
});

test("engine_start_at never creates a period before activation", () => {
  const start = "2026-10-07T18:00:00.000Z";
  const window = nextPeriodWindow({
    settings: settings({
      engineStartAt: start,
      timezone: "America/New_York",
      periodLengthDays: 7,
      periodStartWeekday: 1,
    }),
  });
  assert.ok(!("error" in window));
  assert.ok(Date.parse(window.startsAt) >= Date.parse(start));
  assert.equal(periodStartsOnOrAfterEngine({ engineStartAt: start }, "2026-10-05T00:00:00.000Z"), false);
});

test("timezone America/New_York is used for period bounds", () => {
  const start = new Date(zonedLocalToUtcMs(2026, 3, 2, 0, 0, 0, "America/New_York")).toISOString();
  const window = nextPeriodWindow({
    settings: settings({
      engineStartAt: start,
      timezone: "America/New_York",
      periodLengthDays: 7,
      periodStartWeekday: 1,
    }),
  });
  assert.ok(!("error" in window));
  assert.equal(window.startsAt, "2026-03-02T05:00:00.000Z");
  assert.equal(window.endsAt, "2026-03-09T04:00:00.000Z");
});

test("a different configured timezone changes the bounds", () => {
  const ny = nextPeriodWindow({
    settings: settings({
      engineStartAt: "2026-10-07T18:00:00.000Z",
      timezone: "America/New_York",
      periodLengthDays: 7,
      periodStartWeekday: 1,
    }),
  });
  const paris = nextPeriodWindow({
    settings: settings({
      engineStartAt: "2026-10-07T18:00:00.000Z",
      timezone: "Europe/Paris",
      periodLengthDays: 7,
      periodStartWeekday: 1,
    }),
  });
  assert.ok(!("error" in ny) && !("error" in paris));
  assert.notEqual(ny.endsAt, paris.endsAt);
});

test("spring DST week keeps local midnight boundaries", () => {
  const start = new Date(zonedLocalToUtcMs(2026, 3, 2, 0, 0, 0, "America/New_York")).toISOString();
  const first = nextPeriodWindow({
    settings: settings({
      engineStartAt: start,
      timezone: "America/New_York",
      periodLengthDays: 7,
      periodStartWeekday: 1,
    }),
  });
  assert.ok(!("error" in first));
  assert.equal(Date.parse(first.endsAt) - Date.parse(first.startsAt), 167 * 3600_000);
});

test("fall DST week keeps local midnight boundaries", () => {
  const start = new Date(zonedLocalToUtcMs(2026, 10, 26, 0, 0, 0, "America/New_York")).toISOString();
  const first = nextPeriodWindow({
    settings: settings({
      engineStartAt: start,
      timezone: "America/New_York",
      periodLengthDays: 7,
      periodStartWeekday: 1,
    }),
  });
  assert.ok(!("error" in first));
  assert.equal(Date.parse(first.endsAt) - Date.parse(first.startsAt), 169 * 3600_000);
});

test("chained periods have no overlap and no gap", () => {
  const cfg = settings({
    engineStartAt: "2026-10-07T18:00:00.000Z",
    timezone: "America/New_York",
    periodLengthDays: 7,
    periodStartWeekday: 1,
  });
  const first = nextPeriodWindow({ settings: cfg });
  assert.ok(!("error" in first));
  const second = nextPeriodWindow({ settings: cfg, previousEndsAtIso: first.endsAt });
  const third = nextPeriodWindow({
    settings: cfg,
    previousEndsAtIso: "error" in second ? "" : second.endsAt,
  });
  assert.ok(!("error" in second) && !("error" in third));
  assert.equal(windowsAreContiguous(first, second), true);
  assert.equal(windowsAreContiguous(second, third), true);
  assert.ok(Date.parse(first.endsAt) <= Date.parse(second.startsAt));
});

test("changing period length changes later windows", () => {
  const weekly = nextPeriodWindow({
    settings: settings({
      engineStartAt: "2026-10-12T04:00:00.000Z",
      timezone: "America/New_York",
      periodLengthDays: 7,
      periodStartWeekday: 1,
    }),
    previousEndsAtIso: "2026-10-12T04:00:00.000Z",
  });
  const biweekly = nextPeriodWindow({
    settings: settings({
      engineStartAt: "2026-10-12T04:00:00.000Z",
      timezone: "America/New_York",
      periodLengthDays: 14,
      periodStartWeekday: 1,
    }),
    previousEndsAtIso: "2026-10-12T04:00:00.000Z",
  });
  assert.ok(!("error" in weekly) && !("error" in biweekly));
  assert.notEqual(weekly.endsAt, biweekly.endsAt);
});

test("invalid timezone is fail-closed", () => {
  const window = nextPeriodWindow({
    settings: settings({
      engineStartAt: "2026-10-07T18:00:00.000Z",
      timezone: "Not/AZone",
      periodLengthDays: 7,
      periodStartWeekday: 1,
    }),
  });
  assert.ok("error" in window);
});

test("cron does not pre-create future periods before the current one ends", () => {
  const now = Date.parse("2026-10-08T12:00:00.000Z");
  assert.equal(
    shouldCreatePeriodWindow({
      windowStartsAtIso: "2026-10-07T18:00:00.000Z",
      nowMs: now,
    }),
    true
  );
  assert.equal(
    shouldCreatePeriodWindow({
      previousEndsAtIso: "2026-10-12T04:00:00.000Z",
      windowStartsAtIso: "2026-10-12T04:00:00.000Z",
      nowMs: now,
    }),
    false
  );
  assert.equal(
    shouldCreatePeriodWindow({
      previousEndsAtIso: "2026-10-12T04:00:00.000Z",
      windowStartsAtIso: "2026-10-12T04:00:00.000Z",
      nowMs: Date.parse("2026-10-12T04:00:00.000Z"),
    }),
    true
  );
});

test("existing period is preserved so a later rule cannot rewrite it", () => {
  assert.equal(existingPeriodMustBePreserved(null), false);
  assert.equal(
    existingPeriodMustBePreserved({ id: "p1", rule_version_id: "v1", status: "reconciled" }),
    true
  );
});

test("stale on-call uses the configured seconds not a hardcoded 10 minutes", () => {
  const start = "2000-01-01T00:00:00.000Z";
  const now = Date.parse("2000-01-01T01:00:00.000Z");
  assert.equal(resolveOnCallEndedAt(start, null, now, null), null);
  assert.equal(resolveOnCallEndedAt(start, null, now, 900), "2000-01-01T00:15:00.000Z");
});
