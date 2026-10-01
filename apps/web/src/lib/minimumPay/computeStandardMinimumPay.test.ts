import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAdjustmentIdempotencyKey,
  computeStandardMinimumPay,
} from "./computeStandardMinimumPay";

const HOUR = 3600_000;

function interval(startHour: number, endHour: number) {
  const origin = Date.parse("2000-01-03T00:00:00.000Z");
  return {
    startedAtMs: origin + startHour * HOUR,
    endedAtMs: origin + endHour * HOUR,
  };
}

function run(input: {
  mpr: number;
  rounding?: string;
  tripHours?: number;
  onCallHours?: number;
  eligibleCents?: number;
  tipCents?: number;
  extraDrivers?: Array<{
    id: string;
    tripHours: number;
    onCallHours: number;
    eligibleCents: number;
  }>;
}) {
  const tripHours = input.tripHours ?? 0;
  const onCallHours = input.onCallHours ?? 0;
  return computeStandardMinimumPay({
    config: {
      method: "standard",
      mprCentsPerHour: input.mpr,
      rounding: input.rounding ?? "ceil_cents",
    },
    periodStartsAtMs: Date.parse("2000-01-03T00:00:00.000Z"),
    periodEndsAtMs: Date.parse("2000-01-10T00:00:00.000Z"),
    drivers: [
      {
        driverId: "driver-a",
        tripIntervals: tripHours ? [interval(0, tripHours)] : [],
        onCallIntervals: onCallHours ? [interval(tripHours, tripHours + onCallHours)] : [],
        earnings: [
          {
            sourceType: "delivery_share",
            amountCents: input.eligibleCents ?? 0,
            countsTowardMpr: true,
          },
          {
            sourceType: "tip",
            amountCents: input.tipCents ?? 0,
            countsTowardMpr: false,
          },
        ],
      },
      ...(input.extraDrivers ?? []).map((row) => ({
        driverId: row.id,
        tripIntervals: row.tripHours ? [interval(0, row.tripHours)] : [],
        onCallIntervals: row.onCallHours
          ? [interval(row.tripHours, row.tripHours + row.onCallHours)]
          : [],
        earnings: [
          {
            sourceType: "delivery_share",
            amountCents: row.eligibleCents,
            countsTowardMpr: true,
          },
        ],
      })),
    ],
  });
}

test("A above minimum => adjustment 0", () => {
  const result = run({ mpr: 1000, tripHours: 1, eligibleCents: 1500 });
  assert.equal(result.drivers[0].adjustmentCents, 0);
});

test("B exact minimum => adjustment 0", () => {
  const result = run({ mpr: 1000, tripHours: 1, eligibleCents: 1000 });
  assert.equal(result.drivers[0].adjustmentCents, 0);
});

test("C below minimum => positive adjustment", () => {
  const result = run({ mpr: 1000, tripHours: 1, eligibleCents: 400 });
  assert.equal(result.drivers[0].requiredCents, 1000);
  assert.equal(result.drivers[0].adjustmentCents, 600);
});

test("D quoted short / actual long uses real trip seconds", () => {
  const result = run({ mpr: 1200, tripHours: 70 / 60, eligibleCents: 500 });
  assert.ok(result.drivers[0].tripSeconds >= 69 * 60);
  assert.ok(result.drivers[0].requiredCents > 500);
  assert.ok(result.drivers[0].adjustmentCents > 0);
});

test("E cancelled trip still counts trip seconds", () => {
  const result = run({ mpr: 2000, tripHours: 0.5, eligibleCents: 0 });
  assert.equal(result.drivers[0].tripSeconds, 1800);
  assert.ok(result.drivers[0].adjustmentCents > 0);
});

test("F stacked overlapping trips use union not sum", () => {
  const origin = Date.parse("2000-01-03T00:00:00.000Z");
  const result = computeStandardMinimumPay({
    config: { method: "standard", mprCentsPerHour: 3600, rounding: "floor_cents" },
    periodStartsAtMs: origin,
    periodEndsAtMs: origin + 10 * HOUR,
    drivers: [
      {
        driverId: "driver-a",
        tripIntervals: [
          { startedAtMs: origin, endedAtMs: origin + 40 * 60_000 },
          { startedAtMs: origin + 10 * 60_000, endedAtMs: origin + 50 * 60_000 },
        ],
        onCallIntervals: [],
        earnings: [],
      },
    ],
  });
  assert.equal(result.drivers[0].tripSeconds, 50 * 60);
});

test("G large tip does not reduce deficit", () => {
  const withoutTip = run({ mpr: 1000, tripHours: 1, eligibleCents: 200, tipCents: 0 });
  const withTip = run({ mpr: 1000, tripHours: 1, eligibleCents: 200, tipCents: 9000 });
  assert.equal(withoutTip.drivers[0].adjustmentCents, withTip.drivers[0].adjustmentCents);
  assert.equal(withTip.drivers[0].excludedEarningsCents, 9000);
});

test("H idempotency key is stable", () => {
  const a = buildAdjustmentIdempotencyKey({
    driverId: "d1",
    payPeriodId: "p1",
    ruleVersionId: "r1",
    method: "standard",
    kind: "individual",
  });
  const b = buildAdjustmentIdempotencyKey({
    driverId: "d1",
    payPeriodId: "p1",
    ruleVersionId: "r1",
    method: "standard",
    kind: "individual",
  });
  assert.equal(a, b);
});

test("J changing configured rate changes required amount", () => {
  const low = run({ mpr: 1000, tripHours: 2, eligibleCents: 0 });
  const high = run({ mpr: 2500, tripHours: 2, eligibleCents: 0 });
  assert.equal(low.drivers[0].requiredCents, 2000);
  assert.equal(high.drivers[0].requiredCents, 5000);
});

test("changing the period window changes the clipped trip calculation", () => {
  const origin = Date.parse("2000-01-03T00:00:00.000Z");
  const trip = { startedAtMs: origin, endedAtMs: origin + 4 * HOUR };
  const short = computeStandardMinimumPay({
    config: { method: "standard", mprCentsPerHour: 1000, rounding: "floor_cents" },
    periodStartsAtMs: origin,
    periodEndsAtMs: origin + 2 * HOUR,
    drivers: [{ driverId: "driver-a", tripIntervals: [trip], onCallIntervals: [], earnings: [] }],
  });
  const long = computeStandardMinimumPay({
    config: { method: "standard", mprCentsPerHour: 1000, rounding: "floor_cents" },
    periodStartsAtMs: origin,
    periodEndsAtMs: origin + 4 * HOUR,
    drivers: [{ driverId: "driver-a", tripIntervals: [trip], onCallIntervals: [], earnings: [] }],
  });
  assert.equal(short.drivers[0].tripSeconds, 2 * 3600);
  assert.equal(long.drivers[0].tripSeconds, 4 * 3600);
  assert.notEqual(short.drivers[0].requiredCents, long.drivers[0].requiredCents);
});

test("K multiple disjoint on-call sessions sum after trip subtraction", () => {
  const origin = Date.parse("2000-01-03T00:00:00.000Z");
  const result = computeStandardMinimumPay({
    config: { method: "standard", mprCentsPerHour: 1000, rounding: "floor_cents" },
    periodStartsAtMs: origin,
    periodEndsAtMs: origin + 10 * HOUR,
    drivers: [
      {
        driverId: "driver-a",
        tripIntervals: [{ startedAtMs: origin + HOUR, endedAtMs: origin + 2 * HOUR }],
        onCallIntervals: [
          { startedAtMs: origin, endedAtMs: origin + HOUR },
          { startedAtMs: origin + 2 * HOUR, endedAtMs: origin + 3 * HOUR },
        ],
        earnings: [],
      },
    ],
  });
  assert.equal(result.drivers[0].onCallSeconds, 2 * 3600);
  assert.equal(result.drivers[0].tripSeconds, 3600);
});

test("L overlapping on-call sessions are unioned", () => {
  const origin = Date.parse("2000-01-03T00:00:00.000Z");
  const result = computeStandardMinimumPay({
    config: { method: "standard", mprCentsPerHour: 1000, rounding: "floor_cents" },
    periodStartsAtMs: origin,
    periodEndsAtMs: origin + 5 * HOUR,
    drivers: [
      {
        driverId: "driver-a",
        tripIntervals: [],
        onCallIntervals: [
          { startedAtMs: origin, endedAtMs: origin + 2 * HOUR },
          { startedAtMs: origin + HOUR, endedAtMs: origin + 3 * HOUR },
        ],
        earnings: [],
      },
    ],
  });
  assert.equal(result.drivers[0].onCallSeconds, 3 * 3600);
});

test("Q fleet aggregate uses trip plus on-call", () => {
  const result = run({
    mpr: 1000,
    tripHours: 1,
    onCallHours: 1,
    eligibleCents: 1000,
    extraDrivers: [{ id: "driver-b", tripHours: 1, onCallHours: 1, eligibleCents: 1000 }],
  });
  assert.equal(result.fleetTripSeconds, 2 * 3600);
  assert.equal(result.fleetOnCallSeconds, 2 * 3600);
  assert.equal(result.requiredAggCents, 4000);
});

test("waiting beyond any operational threshold does not automatically remove pay", () => {
  const result = run({ mpr: 1000, tripHours: 2, eligibleCents: 0 });
  assert.equal(result.drivers[0].tripSeconds, 2 * 3600);
  assert.equal(result.drivers[0].requiredCents, 2000);
  assert.equal(result.drivers[0].adjustmentCents, 2000);
});

test("unknown method is rejected", () => {
  assert.throws(
    () =>
      computeStandardMinimumPay({
        config: { method: "other", mprCentsPerHour: 1000, rounding: "ceil_cents" },
        periodStartsAtMs: 1,
        periodEndsAtMs: 2,
        drivers: [],
      }),
    /unsupported_method/
  );
});
