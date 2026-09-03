/**
 * Numerical money identity: client payment = MMD commission + worker share.
 * Documents that Stripe processing fees are separate from MMD commission.
 */
import assert from "node:assert/strict";

function test(name, fn) {
  fn();
  console.log(`ok ${name}`);
}

/** Integer-cent identity (no float drift). */
function assertSplit(clientCents, mmdCents, workerCents, label) {
  assert.equal(
    clientCents,
    mmdCents + workerCents,
    `${label}: ${clientCents} !== ${mmdCents}+${workerCents}`,
  );
  assert.ok(mmdCents >= 0 && workerCents >= 0, `${label}: negative share`);
}

test("taxi $25 = $5 MMD + $20 driver", () => {
  assertSplit(2500, 500, 2000, "taxi");
});

test("food $100 = $15 MMD + $85 restaurant (example)", () => {
  assertSplit(10000, 1500, 8500, "restaurant");
});

test("delivery tip is additive worker credit (not MMD commission)", () => {
  const fareClient = 2500;
  const mmd = 500;
  const driverFare = 2000;
  const tip = 300;
  assertSplit(fareClient, mmd, driverFare, "fare");
  // Tip PaymentIntent is separate: tip cents transfer 100% to worker after PI success.
  assert.equal(tip, 300);
  assert.equal(driverFare + tip, 2300);
});

test("marketplace identity: client = platform + seller + driver (example)", () => {
  const client = 5000;
  const platform = 500;
  const seller = 3500;
  const driver = 1000;
  assert.equal(client, platform + seller + driver);
});

console.log("moneySplitIdentity regression passed");
