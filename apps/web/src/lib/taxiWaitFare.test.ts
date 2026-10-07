import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { computeWaitFeeCents, computeWaitTimerState } from "./waitFeeCalculator";
import { WAIT_FEE_MAX_CENTS, WAIT_TIMER_FREE_MINUTES } from "./waitTimerTypes";
import { buildTaxiCustomerWaitView, taxiWaitCentsToApply } from "./taxiWaitFare";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

test("waiting fee formula stays 5 free minutes and a $2.25 cap", () => {
  assert.equal(WAIT_TIMER_FREE_MINUTES, 5);
  assert.equal(WAIT_FEE_MAX_CENTS, 225);
  assert.equal(computeWaitFeeCents(0), 0);
  assert.equal(computeWaitFeeCents(1), 25);
  assert.equal(computeWaitFeeCents(3), 75);
  assert.equal(computeWaitFeeCents(4), 105);
  assert.equal(computeWaitFeeCents(8), 225);
  assert.equal(computeWaitFeeCents(8.9), 225);
});

test("customer wait view uses the server clock and freezes at trip start", () => {
  const started = "2026-10-07T12:00:00.000Z";
  const duringFree = buildTaxiCustomerWaitView({
    status: "driver_arrived",
    waitTimerStartedAt: started,
    driverArrivedAt: started,
    startedAt: null,
    freeWaitMinutes: 5,
    storedWaitFeeCents: 0,
    now: new Date("2026-10-07T12:04:00.000Z"),
  });
  assert.equal(duringFree.wait_active, true);
  assert.equal(duringFree.wait_fee_cents, 0);
  assert.equal(duringFree.remaining_free_seconds, 60);

  const boarded = buildTaxiCustomerWaitView({
    status: "in_progress",
    waitTimerStartedAt: started,
    driverArrivedAt: started,
    startedAt: "2026-10-07T12:06:30.000Z",
    freeWaitMinutes: 5,
    storedWaitFeeCents: 25,
    now: new Date("2026-10-07T13:00:00.000Z"),
  });
  assert.equal(boarded.wait_active, false);
  assert.equal(boarded.trip_started, true);
  assert.equal(boarded.final_wait_fee_cents, 25);
  assert.equal(
    computeWaitTimerState({
      waitTimerStartedAt: started,
      waitEndedAt: "2026-10-07T12:06:30.000Z",
      now: new Date("2026-10-07T13:00:00.000Z"),
      entityKind: "taxi",
    }).wait_fee_cents,
    25,
  );
});

test("the same wait fee is added to the trip total only once", () => {
  assert.equal(taxiWaitCentsToApply({ feeCents: 125, alreadyApplied: false }), 125);
  assert.equal(taxiWaitCentsToApply({ feeCents: 125, alreadyApplied: true }), 0);
  assert.equal(taxiWaitCentsToApply({ feeCents: 0, alreadyApplied: false }), 0);
});

test("pickup wait is finalized on trip start and is not a second Stripe charge", () => {
  const start = fs.readFileSync(
    path.join(repoRoot, "apps/web/app/api/taxi/rides/start/route.ts"),
    "utf8",
  );
  const finalizer = fs.readFileSync(
    path.join(repoRoot, "apps/web/src/lib/taxiWaitFareFinalization.ts"),
    "utf8",
  );
  const customer = fs.readFileSync(
    path.join(repoRoot, "apps/web/app/api/taxi/rides/wait-status/route.ts"),
    "utf8",
  );
  const stop = fs.readFileSync(
    path.join(repoRoot, "apps/web/app/api/taxi/rides/stops/arrive/route.ts"),
    "utf8",
  );
  assert.match(start, /finalizeTaxiWaitOnTripStart/);
  assert.match(finalizer, /chargeWaitLateFeeIfEligible/);
  assert.match(finalizer, /wait_fee_applied_to_total/);
  assert.doesNotMatch(finalizer, /paymentIntents\.create/);
  assert.doesNotMatch(finalizer, /stripe\./);
  assert.match(customer, /export async function GET/);
  assert.match(customer, /method_not_allowed/);
  assert.doesNotMatch(customer, /\.update\(/);
  assert.doesNotMatch(stop, /finalizeTaxiWaitOnTripStart/);
  assert.doesNotMatch(stop, /wait_timer_started_at/);
});

test("customer wait copy exists in all six locales", () => {
  for (const locale of ["en", "fr", "es", "ar", "zh", "ff"]) {
    const raw = fs.readFileSync(
      path.join(repoRoot, `apps/mobile/src/i18n/locales/${locale}/extras.json`),
      "utf8",
    );
    for (const key of ["waitTitle", "waitClock", "waitFree", "waitFee", "waitMax", "waitStale"]) {
      assert.match(raw, new RegExp(`"${key}"\\s*:`), locale);
    }
  }
});
