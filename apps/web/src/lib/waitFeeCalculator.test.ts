import assert from "node:assert/strict";
import test from "node:test";
import { computeWaitFeeCents, computeWaitTimerState } from "./waitFeeCalculator";

test("computeWaitFeeCents follows tiered pricing up to max", () => {
  assert.equal(computeWaitFeeCents(0), 0);
  assert.equal(computeWaitFeeCents(1), 25);
  assert.equal(computeWaitFeeCents(3), 75);
  assert.equal(computeWaitFeeCents(4), 105);
  assert.equal(computeWaitFeeCents(8), 225);
  assert.equal(computeWaitFeeCents(20), 225);
});

test("taxi wait is free for 5 minutes, then tiered, and stops at trip start", () => {
  const started = new Date("2026-10-07T12:00:00.000Z");
  const duringFree = computeWaitTimerState({
    waitTimerStartedAt: started,
    now: new Date("2026-10-07T12:04:59.000Z"),
    entityKind: "taxi",
  });
  assert.equal(duringFree.wait_fee_cents, 0);
  assert.equal(duringFree.wait_fee_status, "free");
  assert.equal(duringFree.can_cancel_no_penalty, false);

  const oneBillableMinute = computeWaitTimerState({
    waitTimerStartedAt: started,
    now: new Date("2026-10-07T12:06:10.000Z"),
    entityKind: "taxi",
  });
  assert.equal(oneBillableMinute.billable_minutes, 1);
  assert.equal(oneBillableMinute.wait_fee_cents, 25);

  const boarded = computeWaitTimerState({
    waitTimerStartedAt: started,
    waitEndedAt: new Date("2026-10-07T12:06:00.000Z"),
    now: new Date("2026-10-07T13:30:00.000Z"),
    entityKind: "taxi",
  });
  assert.equal(boarded.billable_minutes, 1);
  assert.equal(boarded.wait_fee_cents, 25);

  const beforeArrival = computeWaitTimerState({
    waitTimerStartedAt: null,
    entityKind: "taxi",
  });
  assert.equal(beforeArrival.elapsed_seconds, 0);
  assert.equal(beforeArrival.wait_fee_cents, 0);
});

test("computeWaitTimerState exposes deposit and no-show gates after cap", () => {
  const started = new Date(Date.now() - 13 * 60 * 1000);
  const delivery = computeWaitTimerState({
    waitTimerStartedAt: started,
    leaveAtDoor: true,
    entityKind: "delivery",
  });
  assert.equal(delivery.max_fee_reached, true);
  assert.equal(delivery.can_deposit_at_door, true);
  assert.equal(delivery.wait_fee_cents, 225);

  const taxi = computeWaitTimerState({
    waitTimerStartedAt: started,
    entityKind: "taxi",
  });
  assert.equal(taxi.can_cancel_no_penalty, true);
});
