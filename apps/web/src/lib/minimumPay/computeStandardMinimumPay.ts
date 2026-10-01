import { applyConfiguredRounding, floorSpread, isKnownRounding } from "./money";
import {
  clipInterval,
  durationSeconds,
  subtractIntervals,
  unionIntervals,
} from "./timeUnion";
import type {
  StandardComputeInput,
  StandardComputeResult,
  StandardDriverResult,
  TimeInterval,
} from "./types";

const STANDARD_METHOD = "standard";

function clipAll(
  intervals: TimeInterval[],
  startMs: number,
  endMs: number
): TimeInterval[] {
  const clipped: TimeInterval[] = [];
  for (const row of intervals) {
    const next = clipInterval(row, startMs, endMs);
    if (next) clipped.push(next);
  }
  return unionIntervals(clipped);
}

function eligibleEarningsCents(
  earnings: StandardComputeInput["drivers"][number]["earnings"]
): { included: number; excluded: number } {
  let included = 0;
  let excluded = 0;
  for (const line of earnings) {
    const cents = Math.trunc(Number(line.amountCents) || 0);
    if (line.countsTowardMpr) included += cents;
    else excluded += cents;
  }
  return { included, excluded };
}

export function computeStandardMinimumPay(
  input: StandardComputeInput
): StandardComputeResult {
  if (input.config.method !== STANDARD_METHOD) {
    throw new Error("minimum_pay_unsupported_method");
  }
  if (!isKnownRounding(input.config.rounding)) {
    throw new Error("minimum_pay_unknown_rounding");
  }
  if (!Number.isInteger(input.config.mprCentsPerHour) || input.config.mprCentsPerHour <= 0) {
    throw new Error("minimum_pay_invalid_mpr");
  }
  if (input.periodEndsAtMs <= input.periodStartsAtMs) {
    throw new Error("minimum_pay_invalid_period");
  }

  const drivers: StandardDriverResult[] = input.drivers.map((driver) => {
    const trip = clipAll(
      driver.tripIntervals,
      input.periodStartsAtMs,
      input.periodEndsAtMs
    );
    const onCallRaw = clipAll(
      driver.onCallIntervals,
      input.periodStartsAtMs,
      input.periodEndsAtMs
    );
    const onCall = subtractIntervals(onCallRaw, trip);
    const tripSeconds = durationSeconds(trip);
    const onCallSeconds = durationSeconds(onCall);
    const requiredCents = applyConfiguredRounding(
      input.config.mprCentsPerHour,
      tripSeconds,
      input.config.rounding
    );
    const { included, excluded } = eligibleEarningsCents(driver.earnings);
    const deficitCents = Math.max(0, requiredCents - included);
    return {
      driverId: driver.driverId,
      tripSeconds,
      onCallSeconds,
      requiredCents,
      eligibleCents: included,
      deficitCents,
      adjustmentCents: deficitCents,
      fleetAllocationCents: 0,
      totalAdjustmentCents: deficitCents,
      includedEarningsCents: included,
      excludedEarningsCents: excluded,
    };
  });

  const fleetTripSeconds = drivers.reduce((sum, row) => sum + row.tripSeconds, 0);
  const fleetOnCallSeconds = drivers.reduce((sum, row) => sum + row.onCallSeconds, 0);
  const requiredAggCents = applyConfiguredRounding(
    input.config.mprCentsPerHour,
    fleetTripSeconds + fleetOnCallSeconds,
    input.config.rounding
  );
  const eligibleAggCents = drivers.reduce(
    (sum, row) => sum + row.eligibleCents + row.adjustmentCents,
    0
  );
  const fleetDeficitCents = Math.max(0, requiredAggCents - eligibleAggCents);

  const allocation = floorSpread(
    fleetDeficitCents,
    drivers.map((row) => ({
      id: row.driverId,
      weight: row.onCallSeconds > 0 ? row.onCallSeconds : row.tripSeconds,
    }))
  );

  for (const row of drivers) {
    row.fleetAllocationCents = allocation[row.driverId] ?? 0;
    row.totalAdjustmentCents = row.adjustmentCents + row.fleetAllocationCents;
  }

  return {
    method: input.config.method,
    mprCentsPerHour: input.config.mprCentsPerHour,
    rounding: input.config.rounding,
    fleetTripSeconds,
    fleetOnCallSeconds,
    requiredAggCents,
    eligibleAggCents,
    fleetDeficitCents,
    drivers,
  };
}

export function buildAdjustmentIdempotencyKey(input: {
  driverId: string;
  payPeriodId: string;
  ruleVersionId: string;
  method: string;
  kind: string;
}): string {
  return [
    "nyc_mpr_adjustment",
    input.driverId,
    input.payPeriodId,
    input.ruleVersionId,
    input.method,
    input.kind,
  ].join(":");
}
