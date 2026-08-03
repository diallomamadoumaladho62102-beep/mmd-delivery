/**
 * Phase 2 — Shadow Compare unit tests (no network, no Stripe).
 */
import assert from "node:assert/strict";
import { PRICING_ENGINE_MIGRATION_PHASE } from "./phaseGate";
import {
  resolveChargePath,
  resolvePricingEngineFlags,
} from "./flags";
import {
  isKillSwitchActive,
  isShadowCompareAllowed,
} from "./killSwitch";
import { buildFoodComparablePair } from "./engine/adapters/foodAdapter";
import { buildPackageComparablePair } from "./engine/adapters/packageAdapter";
import { buildRideComparablePair } from "./engine/adapters/rideAdapter";
import { buildMarketplaceComparablePair } from "./engine/adapters/marketplaceAdapter";
import { compareComparableQuotes } from "./shadow/compareQuotes";
import {
  getShadowMetricsSnapshot,
  resetShadowMetricsForTests,
  recordShadowMetrics,
} from "./shadow/metrics";
import { runPricingShadowCompare } from "./shadow/runShadowCompare";
import type { FoodOrderPricingResult } from "../foodOrderServerPricing";

assert.equal(PRICING_ENGINE_MIGRATION_PHASE, 5);
assert.equal(resolveChargePath(resolvePricingEngineFlags({}), "food"), "legacy");

const killed = resolvePricingEngineFlags({
  PRICING_ENGINE_KILL_SWITCH: "true",
  PRICING_ENGINE_SHADOW: "true",
});
assert.equal(isKillSwitchActive(killed), true);
assert.equal(isShadowCompareAllowed(killed), false);

const shadowOn = resolvePricingEngineFlags({
  PRICING_ENGINE_SHADOW: "true",
  PRICING_ENGINE_KILL_SWITCH: "false",
});
assert.equal(isShadowCompareAllowed(shadowOn), true);

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

const foodPair = buildFoodComparablePair(foodPricing);
const foodReport = compareComparableQuotes({
  legacy: foodPair.legacy,
  engine: foodPair.engine,
  legacyLatencyMs: 10,
  engineLatencyMs: 2,
  compareId: "test-food",
});
assert.equal(foodReport.equal, true, JSON.stringify(foodReport.fieldDiffs));
assert.equal(foodReport.diffCents, 0);

const pkgPair = buildPackageComparablePair({
  currency: "USD",
  subtotal: 0,
  tax: 0,
  deliveryFee: 9.25,
  serviceFee: 0,
  discounts: 0,
  totalCents: 925,
  driverPayoutEstimate: 7.4,
  deliveryFeeRaw: 9.25,
});
assert.equal(
  compareComparableQuotes({
    legacy: pkgPair.legacy,
    engine: pkgPair.engine,
    legacyLatencyMs: 1,
    engineLatencyMs: 1,
    compareId: "test-pkg",
  }).equal,
  true
);

const ridePair = buildRideComparablePair({
  currency: "USD",
  subtotal_cents: 1000,
  tax_cents: 80,
  service_fee_cents: 0,
  platform_fee_cents: 250,
  driver_payout_cents: 750,
  total_cents: 1080,
});
assert.equal(
  compareComparableQuotes({
    legacy: ridePair.legacy,
    engine: ridePair.engine,
    legacyLatencyMs: 1,
    engineLatencyMs: 1,
    compareId: "test-ride",
  }).equal,
  true
);

const mktPair = buildMarketplaceComparablePair({
  currency: "USD",
  subtotal_cents: 10000,
  delivery_fee_cents: 800,
  service_fee_cents: 0,
  total_cents: 10800,
});
assert.equal(
  compareComparableQuotes({
    legacy: mktPair.legacy,
    engine: mktPair.engine,
    legacyLatencyMs: 1,
    engineLatencyMs: 1,
    compareId: "test-mkt",
  }).equal,
  true
);

resetShadowMetricsForTests();
recordShadowMetrics({ equal: true, legacyLatencyMs: 5, engineLatencyMs: 3 });
recordShadowMetrics({ equal: false, legacyLatencyMs: 5, engineLatencyMs: 4 });
const metrics = getShadowMetricsSnapshot();
assert.equal(metrics.compared, 2);
assert.equal(metrics.equal, 1);
assert.equal(metrics.diff, 1);
assert.equal(metrics.parityPct, 50);

// Missing SHADOW (default flags) → runner returns null (no charge impact)
void runPricingShadowCompare({
  legacyLatencyMs: 1,
  buildPair: () => foodPair,
  deps: {},
}).then(async (blocked) => {
  assert.equal(blocked, null);

  const withShadow = await runPricingShadowCompare({
    legacyLatencyMs: 1,
    buildPair: () => foodPair,
    deps: {
      persist: false,
      samplePct: 100,
      flagsOverride: shadowOn,
    },
  });
  assert.ok(withShadow);
  assert.equal(withShadow.equal, true);

  console.log("pricingEngine Phase 2 shadow OK");
});
