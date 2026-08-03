/**
 * Phase 2 — Kill Switch / Feature Flags drill (no Stripe, no charge).
 * Verifies shadow stops immediately and charge path stays legacy.
 */
import assert from "node:assert/strict";
import {
  resolveChargePath,
  resolvePricingEngineFlags,
} from "./flags";
import {
  isKillSwitchActive,
  isShadowCompareAllowed,
  resolveChargePathForPhase,
} from "./killSwitch";
import { PRICING_ENGINE_MIGRATION_PHASE } from "./phaseGate";
import { buildFoodComparablePair } from "./engine/adapters/foodAdapter";
import { runPricingShadowCompare } from "./shadow/runShadowCompare";
import {
  clearShadowJournalForTests,
  getShadowJournalEntries,
} from "./shadow/journal";
import {
  getShadowMetricsSnapshot,
  resetShadowMetricsForTests,
} from "./shadow/metrics";
import type { FoodOrderPricingResult } from "../foodOrderServerPricing";
import type { PricingEngineFlags } from "./flagTypes";

assert.equal(PRICING_ENGINE_MIGRATION_PHASE, 5);

const foodPricing = {
  countryCode: "US",
  currency: "USD",
  configKey: "food_default",
  items: [],
  subtotal: 12,
  tax: 1.07,
  taxRatePct: 8.88,
  taxSource: "legacy_us_food_rate",
  serviceFee: 0,
  serviceFeeCents: 0,
  serviceFeePct: 0,
  serviceFeeEnabled: false,
  serviceFeeFixedCents: 0,
  deliveryFeeRaw: 5.5,
  deliveryFee: 5.5,
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
  subtotalAfterDiscount: 12,
  total: 18.57,
  totalCents: 1857,
  distanceMiles: 3,
  etaMinutes: 12,
  driverPayoutEstimate: 4.4,
  pickupLat: 0,
  pickupLng: 0,
  pickupAddress: "kill-drill",
} as FoodOrderPricingResult;

const foodPair = buildFoodComparablePair(foodPricing);

const shadowOn: PricingEngineFlags = {
  shadowEnabled: true,
  canaryPct: 0,
  serviceEnabled: {
    ride: false,
    food: false,
    package: false,
    marketplace: false,
  },
  killSwitch: false,
};

const killed: PricingEngineFlags = {
  ...shadowOn,
  killSwitch: true,
};

assert.equal(isKillSwitchActive(killed), true);
assert.equal(isShadowCompareAllowed(killed), false);
assert.equal(isShadowCompareAllowed(shadowOn), true);

// Phase 3: Food/Package may engine with canary 100; Ride/Marketplace always legacy.
const aggressive = resolvePricingEngineFlags({
  PRICING_ENGINE_SHADOW: "true",
  PRICING_ENGINE_KILL_SWITCH: "false",
  PRICING_ENGINE_SERVICE_FOOD: "true",
  PRICING_ENGINE_SERVICE_PACKAGE: "true",
  PRICING_ENGINE_SERVICE_RIDE: "true",
  PRICING_ENGINE_SERVICE_MARKETPLACE: "true",
  PRICING_ENGINE_CANARY_PCT: "100",
});
assert.equal(resolveChargePath(aggressive, "food"), "engine");
assert.equal(resolveChargePath(aggressive, "package"), "engine");
assert.equal(resolveChargePath(aggressive, "ride"), "engine");
assert.equal(resolveChargePath(aggressive, "marketplace"), "engine");

for (const service of ["food", "package", "ride", "marketplace"] as const) {
  assert.equal(resolveChargePathForPhase(killed, service, 3), "legacy");
  assert.equal(resolveChargePathForPhase(shadowOn, service, 2), "legacy");
}

resetShadowMetricsForTests();
clearShadowJournalForTests();

async function drill(): Promise<void> {
  // 1) Shadow ON → compare runs
  const ok = await runPricingShadowCompare({
    legacyLatencyMs: 2,
    buildPair: () => foodPair,
    deps: { persist: false, flagsOverride: shadowOn, samplePct: 100 },
  });
  assert.ok(ok);
  assert.equal(ok.equal, true);
  assert.equal(getShadowJournalEntries().length, 1);

  const beforeKillMetrics = getShadowMetricsSnapshot().compared;

  // 2) Kill Switch ON → shadow returns null immediately (no new journal)
  const blocked = await runPricingShadowCompare({
    legacyLatencyMs: 2,
    buildPair: () => foodPair,
    deps: { persist: false, flagsOverride: killed, samplePct: 100 },
  });
  assert.equal(blocked, null);
  assert.equal(getShadowJournalEntries().length, 1);
  assert.equal(getShadowMetricsSnapshot().compared, beforeKillMetrics);

  // 3) SHADOW off → null
  const shadowOff: PricingEngineFlags = {
    ...shadowOn,
    shadowEnabled: false,
  };
  assert.equal(isShadowCompareAllowed(shadowOff), false);
  const off = await runPricingShadowCompare({
    legacyLatencyMs: 2,
    buildPair: () => foodPair,
    deps: { persist: false, flagsOverride: shadowOff, samplePct: 100 },
  });
  assert.equal(off, null);

  // 4) samplePct 0 → null even with shadow on
  const sampledOut = await runPricingShadowCompare({
    legacyLatencyMs: 2,
    buildPair: () => foodPair,
    deps: { persist: false, flagsOverride: shadowOn, samplePct: 0 },
  });
  assert.equal(sampledOut, null);

  // 5) Kill Switch forces legacy charge selector
  assert.equal(resolveChargePath(killed, "food"), "legacy");

  // 6) Env-style resolve: KILL_SWITCH=true blocks allow
  const envKilled = resolvePricingEngineFlags({
    PRICING_ENGINE_SHADOW: "true",
    PRICING_ENGINE_KILL_SWITCH: "true",
  });
  assert.equal(isKillSwitchActive(envKilled), true);
  assert.equal(isShadowCompareAllowed(envKilled), false);

  console.log("pricingEngine Phase 2 kill switch drill OK");
}

void drill();
