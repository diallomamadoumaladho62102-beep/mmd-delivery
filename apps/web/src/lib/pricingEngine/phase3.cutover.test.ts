/**
 * Phase 3 — Food & Package cutover tests (regression under Phase 5 gate).
 */
import assert from "node:assert/strict";
import { PRICING_ENGINE_MIGRATION_PHASE } from "./phaseGate";
import {
  resolveChargePath,
  resolvePricingEngineFlags,
} from "./flags";
import {
  isKillSwitchActive,
  resolveChargePathForPhase,
} from "./killSwitch";
import { canaryBucket, isInCanaryBucket } from "./canary";
import {
  selectFoodChargePath,
  selectPackageChargePath,
} from "./charge/selectFoodPackageCharge";
import {
  getCutoverMetricsSnapshot,
  resetCutoverMetricsForTests,
} from "./cutoverMetrics";
import {
  clearRememberedQuoteSnapshotsForTests,
  getRememberedQuoteSnapshots,
} from "./snapshot/foodPackageSnapshot";
import type { FoodOrderPricingResult } from "../foodOrderServerPricing";
import type { PricingEngineFlags } from "./flagTypes";

assert.equal(PRICING_ENGINE_MIGRATION_PHASE, 5);

// Defaults: no cutover traffic
const defaults = resolvePricingEngineFlags({});
assert.equal(resolveChargePath(defaults, "food"), "legacy");
assert.equal(resolveChargePath(defaults, "package"), "legacy");
assert.equal(resolveChargePath(defaults, "ride"), "legacy");
assert.equal(resolveChargePath(defaults, "marketplace"), "legacy");

const foodOn: PricingEngineFlags = {
  shadowEnabled: true,
  canaryPct: 100,
  serviceEnabled: {
    ride: false,
    food: true,
    package: true,
    marketplace: false,
  },
  killSwitch: false,
};

assert.equal(
  resolveChargePath(foodOn, "food", { canaryKey: "user-a" }),
  "engine"
);
assert.equal(
  resolveChargePath(foodOn, "package", { canaryKey: "user-a" }),
  "engine"
);
assert.equal(
  resolveChargePath(foodOn, "ride", { canaryKey: "user-a" }),
  "legacy"
);
assert.equal(
  resolveChargePath(foodOn, "marketplace", { canaryKey: "user-a" }),
  "legacy"
);

// Marketplace hard-scoped out without SERVICE_MARKETPLACE; ride requires SERVICE_RIDE
const allOn: PricingEngineFlags = {
  ...foodOn,
  serviceEnabled: {
    ride: true,
    food: true,
    package: true,
    marketplace: true,
  },
};
assert.equal(resolveChargePath(allOn, "ride", { canaryKey: "x" }), "engine");
assert.equal(
  resolveChargePath(allOn, "marketplace", { canaryKey: "x" }),
  "engine"
);
// Phase 4 scope regression: marketplace blocked at phase 4
assert.equal(
  resolveChargePathForPhase(allOn, "marketplace", 4, { canaryKey: "x" }),
  "legacy"
);
// Phase 3 scope regression: ride blocked at phase 3
assert.equal(
  resolveChargePathForPhase(allOn, "ride", 3, { canaryKey: "x" }),
  "legacy"
);

// Kill Switch
const killed: PricingEngineFlags = { ...foodOn, killSwitch: true };
assert.equal(isKillSwitchActive(killed), true);
assert.equal(resolveChargePath(killed, "food", { canaryKey: "x" }), "legacy");

// Canary determinism
const key = "stable-user-42";
const bucket = canaryBucket(key);
assert.ok(bucket >= 0 && bucket < 100);
assert.equal(isInCanaryBucket(key, 0), false);
assert.equal(isInCanaryBucket(key, 100), true);
assert.equal(isInCanaryBucket(key, bucket + 1), true);
assert.equal(isInCanaryBucket(key, bucket), false);
// Same key → same path across calls
const pct = 25;
const a = resolveChargePath(
  { ...foodOn, canaryPct: pct },
  "food",
  { canaryKey: key }
);
const b = resolveChargePath(
  { ...foodOn, canaryPct: pct },
  "food",
  { canaryKey: key }
);
assert.equal(a, b);

// Missing canary key with partial canary → legacy (safe)
assert.equal(
  resolveChargePath({ ...foodOn, canaryPct: 50 }, "food"),
  "legacy"
);

// Phase gate regression
assert.equal(resolveChargePathForPhase(foodOn, "food", 2, { canaryKey: "x" }), "legacy");
assert.equal(resolveChargePathForPhase(foodOn, "food", 3, { canaryKey: "x" }), "engine");

const foodPricing = {
  countryCode: "US",
  currency: "USD",
  configKey: "food_default",
  items: [],
  subtotal: 20,
  tax: 1.776,
  taxRatePct: 8.88,
  taxSource: "legacy_us_food_rate",
  serviceFee: 0,
  serviceFeeCents: 0,
  serviceFeePct: 0,
  serviceFeeEnabled: false,
  serviceFeeFixedCents: 0,
  deliveryFeeRaw: 9.25,
  deliveryFee: 9.25,
  deliveryDiscountAmount: 0,
  marketingDiscountAmount: 0,
  marketingDeliveryDiscountAmount: 0,
  mmdPlusDeliveryDiscountAmount: 0,
  mmdPlusOrderDiscountAmount: 0,
  promoCodeApplied: null,
  promoTypeApplied: null,
  promoValueApplied: null,
  promoDiscountAmount: 0,
  discounts: 0,
  subtotalAfterDiscount: 20,
  total: 31.026,
  totalCents: 3103,
  distanceMiles: 5,
  etaMinutes: 15,
  driverPayoutEstimate: 7.4,
  pickupLat: 0,
  pickupLng: 0,
  pickupAddress: "x",
} as FoodOrderPricingResult;

async function run(): Promise<void> {
  resetCutoverMetricsForTests();
  clearRememberedQuoteSnapshotsForTests();

  const legacySel = await selectFoodChargePath({
    pricing: foodPricing,
    canaryKey: "u1",
    flags: defaults,
    persistSnapshot: false,
  });
  assert.equal(legacySel.chargePath, "legacy");
  assert.equal(legacySel.customerTotalCents, 3103);
  assert.equal(legacySel.snapshot, null);

  const engineSel = await selectFoodChargePath({
    pricing: foodPricing,
    canaryKey: "u1",
    flags: foodOn,
    persistSnapshot: false,
  });
  assert.equal(engineSel.chargePath, "engine");
  assert.equal(engineSel.customerTotalCents, 3103);
  assert.ok(engineSel.snapshot);
  assert.equal(engineSel.snapshot?.service, "food");
  assert.equal(getRememberedQuoteSnapshots().length, 1);

  const pkgSel = await selectPackageChargePath({
    pricing: {
      currency: "USD",
      subtotal: 0,
      tax: 0,
      deliveryFee: 9.25,
      serviceFee: 0,
      discounts: 0,
      totalCents: 925,
      driverPayoutEstimate: 7.4,
      deliveryFeeRaw: 9.25,
      countryCode: "US",
    },
    canaryKey: "u1",
    flags: foodOn,
    persistSnapshot: false,
  });
  assert.equal(pkgSel.chargePath, "engine");
  assert.equal(pkgSel.customerTotalCents, 925);

  const killSel = await selectFoodChargePath({
    pricing: foodPricing,
    canaryKey: "u1",
    flags: killed,
    persistSnapshot: false,
  });
  assert.equal(killSel.chargePath, "legacy");

  // Canary ladder simulation (1 → 5 → 25 → 50 → 100)
  const keys = Array.from({ length: 1000 }, (_, i) => `canary-user-${i}`);
  for (const tier of [1, 5, 25, 50, 100]) {
    let engine = 0;
    for (const k of keys) {
      if (
        resolveChargePath(
          { ...foodOn, canaryPct: tier },
          "food",
          { canaryKey: k }
        ) === "engine"
      ) {
        engine += 1;
      }
    }
    const pct = (engine / keys.length) * 100;
    // Allow ±2pp sampling noise except exact 100
    if (tier === 100) assert.equal(engine, keys.length);
    else {
      assert.ok(
        Math.abs(pct - tier) <= 3,
        `canary tier ${tier}% got ${pct}%`
      );
    }
  }

  const metrics = getCutoverMetricsSnapshot();
  assert.ok(metrics.foodEngine >= 1);
  assert.ok(metrics.packageEngine >= 1);

  console.log("pricingEngine Phase 3 cutover OK", {
    canaryBucketSample: bucket,
    metrics,
  });
}

void run();
