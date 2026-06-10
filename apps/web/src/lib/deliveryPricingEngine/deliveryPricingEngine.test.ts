import assert from "node:assert/strict";
import { calculateCustomerDeliveryPrice } from "./calculateCustomerDeliveryPrice";
import { calculateDriverDeliveryEarning } from "./calculateDriverDeliveryEarning";
import { calculatePlatformMargin } from "./calculatePlatformMargin";
import { runDeliveryPricingV2Engine, shadowCompareV1V2 } from "./shadowCompare";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("calculateCustomerDeliveryPrice applies base, distance, time, service fee", () => {
  const result = calculateCustomerDeliveryPrice({
    distanceMiles: 5,
    durationMinutes: 20,
    baseFee: 2.5,
    perMile: 0.9,
    perMinute: 0.15,
    serviceFee: 1,
    minTotal: 0,
  });

  assert.equal(result.baseFeeCents, 250);
  assert.equal(result.distanceComponentCents, 450);
  assert.equal(result.timeComponentCents, 300);
  assert.equal(result.serviceFeeCents, 100);
  assert.equal(result.totalCents, 1100);
});

test("calculateCustomerDeliveryPrice respects min total and surge", () => {
  const result = calculateCustomerDeliveryPrice({
    distanceMiles: 0,
    durationMinutes: 0,
    baseFee: 1,
    perMile: 0,
    perMinute: 0,
    serviceFee: 0,
    minTotal: 5,
    surgeMultiplier: 1.2,
  });

  assert.equal(result.totalCents, 500);
  assert.equal(result.surgeMultiplier, 1.2);

  const surged = calculateCustomerDeliveryPrice({
    distanceMiles: 10,
    durationMinutes: 10,
    baseFee: 2,
    perMile: 1,
    perMinute: 0.1,
    serviceFee: 1,
    minTotal: 0,
    surgeMultiplier: 1.5,
  });

  assert.equal(surged.totalCents, 2100);
});

test("calculateDriverDeliveryEarning increases with demand and score", () => {
  const low = calculateDriverDeliveryEarning({
    distanceMiles: 4,
    durationMinutes: 15,
    driverScore: 20,
    demandLevel: 0,
  });
  const high = calculateDriverDeliveryEarning({
    distanceMiles: 4,
    durationMinutes: 15,
    driverScore: 90,
    demandLevel: 0.8,
    activeDriversInZone: 2,
  });

  assert.ok(high.earningCents > low.earningCents);
});

test("calculatePlatformMargin is customer minus driver", () => {
  const margin = calculatePlatformMargin(1200, 900);
  assert.equal(margin.marginCents, 300);
});

test("shadowCompareV1V2 computes diffs against V1 snapshot", () => {
  const v2 = runDeliveryPricingV2Engine({
    distanceMiles: 3,
    durationMinutes: 12,
  });

  const comparison = shadowCompareV1V2(
    {
      customerTotalCents: 1000,
      driverEarningCents: 800,
      platformMarginCents: 200,
    },
    v2
  );

  assert.equal(
    comparison.diffCustomerCents,
    comparison.v2.customerTotalCents - 1000
  );
  assert.equal(
    comparison.diffDriverCents,
    comparison.v2.driverEarningCents - 800
  );
  assert.equal(
    comparison.diffMarginCents,
    comparison.v2.platformMarginCents - 200
  );
});

console.log("deliveryPricingEngine tests passed");
