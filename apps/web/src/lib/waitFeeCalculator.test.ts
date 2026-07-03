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
