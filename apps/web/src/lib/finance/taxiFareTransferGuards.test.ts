import assert from "node:assert/strict";
import {
  buildTaxiFareTransferIdempotencyKey,
  isStripeTransferReversed,
  resolveTaxiFareTransferReusePlan,
  taxiFareTransferGroup,
} from "./taxiFareTransferGuards";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("successful transfer is not reversed", () => {
  assert.equal(
    isStripeTransferReversed({
      id: "tr_ok",
      reversed: false,
      amount: 1000,
      amount_reversed: 0,
    }),
    false,
  );
});

test("reversed flag marks transfer reversed", () => {
  assert.equal(
    isStripeTransferReversed({
      id: "tr_rev",
      reversed: true,
      amount: 1000,
      amount_reversed: 0,
    }),
    true,
  );
});

test("full amount_reversed marks transfer reversed", () => {
  assert.equal(
    isStripeTransferReversed({
      id: "tr_rev2",
      reversed: false,
      amount: 1000,
      amount_reversed: 1000,
    }),
    true,
  );
});

test("idempotency key changes after reverse", () => {
  const base = buildTaxiFareTransferIdempotencyKey("ride-1");
  const after = buildTaxiFareTransferIdempotencyKey("ride-1", "tr_reversed");
  assert.equal(base, "taxi_driver_payout:ride-1");
  assert.equal(after, "taxi_driver_payout:ride-1:after:tr_reversed");
  assert.notEqual(base, after);
});

test("reuse plan prefers active transfer (anti double transfer)", () => {
  const plan = resolveTaxiFareTransferReusePlan([
    {
      id: "tr_old_rev",
      reversed: true,
      amount: 1000,
      amount_reversed: 1000,
      created: 1,
    },
    {
      id: "tr_active",
      reversed: false,
      amount: 1000,
      amount_reversed: 0,
      created: 2,
    },
  ]);
  assert.equal(plan.reusableTransferId, "tr_active");
  assert.equal(plan.afterReversedTransferId, null);
});

test("reuse plan after only reversed → new key seed", () => {
  const plan = resolveTaxiFareTransferReusePlan([
    {
      id: "tr_a",
      reversed: true,
      amount: 500,
      amount_reversed: 500,
      created: 10,
    },
    {
      id: "tr_b",
      reversed: true,
      amount: 500,
      amount_reversed: 500,
      created: 20,
    },
  ]);
  assert.equal(plan.reusableTransferId, null);
  assert.equal(plan.afterReversedTransferId, "tr_b");
  assert.equal(
    buildTaxiFareTransferIdempotencyKey("ride-9", plan.afterReversedTransferId),
    "taxi_driver_payout:ride-9:after:tr_b",
  );
});

test("empty plan has stable first-attempt key", () => {
  const plan = resolveTaxiFareTransferReusePlan([]);
  assert.equal(plan.reusableTransferId, null);
  assert.equal(plan.afterReversedTransferId, null);
  assert.equal(
    buildTaxiFareTransferIdempotencyKey("abc", plan.afterReversedTransferId),
    "taxi_driver_payout:abc",
  );
});

test("transfer group is stable per ride", () => {
  assert.equal(taxiFareTransferGroup("ride-x"), "taxi_ride:ride-x");
});

console.log("taxiFareTransferGuards.test.ts: ok");
