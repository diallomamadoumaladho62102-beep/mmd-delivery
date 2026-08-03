/**
 * Phase 2 staging-volume parity harness (offline).
 * ≥500 synthetic quotes across Food / Package / Ride / Marketplace.
 * Never charges; never calls Stripe; charge path stays legacy.
 *
 * Run: pnpm exec tsx src/lib/pricingEngine/phase2ParityHarness.ts
 */
import assert from "node:assert/strict";
import { resolveChargePath, resolvePricingEngineFlags } from "./flags";
import { resolveChargePathForPhase } from "./killSwitch";
import { PRICING_ENGINE_MIGRATION_PHASE } from "./phaseGate";
import { buildFoodComparablePair } from "./engine/adapters/foodAdapter";
import { buildPackageComparablePair } from "./engine/adapters/packageAdapter";
import { buildRideComparablePair } from "./engine/adapters/rideAdapter";
import { buildMarketplaceComparablePair } from "./engine/adapters/marketplaceAdapter";
import { getPricingBusinessDefaults } from "./config/businessDefaults";
import { runPricingShadowCompare } from "./shadow/runShadowCompare";
import {
  formatShadowMetricsReport,
  resetShadowMetricsForTests,
} from "./shadow/metrics";
import {
  clearShadowJournalForTests,
  summarizeShadowJournal,
} from "./shadow/journal";
import type { FoodOrderPricingResult } from "../foodOrderServerPricing";
import type { PricingEngineFlags } from "./flagTypes";

const STAGING_N = 520;
const PARITY_GATE_PCT = 99.5;

const shadowFlags: PricingEngineFlags = {
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

const currencies = ["USD", "CAD", "EUR", "GBP"] as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function foodScenario(i: number): FoodOrderPricingResult {
  const currency = currencies[i % currencies.length];
  const subtotal = round2(8 + (i % 40) * 1.25 + (i % 7) * 0.33);
  const taxRate = 0.0888;
  const tax = round2(subtotal * taxRate);
  const distanceMiles = round2(0.5 + (i % 25) * 0.35);
  const etaMinutes = 8 + (i % 35);
  const deliveryFeeRaw = round2(3.49 + distanceMiles * 0.9 + etaMinutes * 0.15);
  const discounts = i % 11 === 0 ? round2(1 + (i % 5) * 0.5) : 0;
  const serviceFee = i % 13 === 0 ? round2(0.99) : 0;
  const deliveryFee = round2(Math.max(0, deliveryFeeRaw - discounts * 0.5));
  const total = round2(subtotal + tax + deliveryFee + serviceFee - discounts);
  const totalCents = Math.round(total * 100);
  const driverPayoutEstimate = round2(deliveryFeeRaw * 0.8);

  return {
    countryCode: currency === "CAD" ? "CA" : "US",
    currency,
    configKey: "food_default",
    items: [],
    subtotal,
    tax,
    taxRatePct: taxRate * 100,
    taxSource: "legacy_us_food_rate",
    serviceFee,
    serviceFeeCents: Math.round(serviceFee * 100),
    serviceFeePct: 0,
    serviceFeeEnabled: serviceFee > 0,
    serviceFeeFixedCents: 0,
    deliveryFeeRaw,
    deliveryFee,
    deliveryDiscountAmount: 0,
    marketingDiscountAmount: 0,
    marketingDeliveryDiscountAmount: 0,
    mmdPlusDeliveryDiscountAmount: 0,
    mmdPlusOrderDiscountAmount: 0,
    promoCodeApplied: discounts > 0 ? "HARNESS" : null,
    promoTypeApplied: discounts > 0 ? "fixed" : null,
    promoValueApplied: discounts > 0 ? discounts : null,
    promoDiscountAmount: discounts,
    discounts,
    subtotalAfterDiscount: round2(subtotal - discounts),
    total,
    totalCents,
    distanceMiles,
    etaMinutes,
    driverPayoutEstimate,
    pickupLat: 25.76,
    pickupLng: -80.19,
    pickupAddress: `harness-${i}`,
  } as FoodOrderPricingResult;
}

function packageScenario(i: number) {
  const currency = currencies[i % currencies.length];
  const deliveryFeeRaw = round2(3.49 + (i % 30) * 0.55);
  const deliveryFee = deliveryFeeRaw;
  const serviceFee = i % 9 === 0 ? 0.99 : 0;
  const discounts = i % 17 === 0 ? 1.5 : 0;
  const total = round2(deliveryFee + serviceFee - discounts);
  return {
    currency,
    subtotal: 0,
    tax: 0,
    deliveryFee,
    serviceFee,
    discounts,
    totalCents: Math.round(total * 100),
    driverPayoutEstimate: round2(deliveryFeeRaw * 0.8),
    deliveryFeeRaw,
  };
}

function rideScenario(i: number) {
  const currency = currencies[i % currencies.length];
  const subtotal_cents = 500 + (i % 80) * 75 + (i % 3) * 11;
  const tax_cents = Math.round(subtotal_cents * 0.08);
  const service_fee_cents = i % 5 === 0 ? 150 : 0;
  const shared_discount_cents =
    i % 7 === 0 ? Math.round(subtotal_cents * 0.15) : 0;
  const promo_discount_cents = i % 11 === 0 ? 200 : 0;
  const platform_fee_cents = Math.round(subtotal_cents * 0.25);
  const driver_payout_cents = subtotal_cents - platform_fee_cents;
  const total_cents =
    subtotal_cents +
    tax_cents +
    service_fee_cents -
    shared_discount_cents -
    promo_discount_cents;
  return {
    currency,
    subtotal_cents,
    tax_cents,
    service_fee_cents,
    platform_fee_cents,
    driver_payout_cents,
    shared_ride: shared_discount_cents > 0,
    shared_discount_cents,
    promo_discount_cents,
    total_cents,
  };
}

function marketplaceScenario(i: number) {
  const d = getPricingBusinessDefaults();
  const currency = currencies[i % currencies.length];
  const subtotal_cents = 1500 + (i % 100) * 250;
  const delivery_fee_cents = Math.max(
    d.marketplace_delivery_fee_floor_cents,
    Math.round(subtotal_cents * d.marketplace_delivery_fee_pct)
  );
  const service_fee_cents = i % 8 === 0 ? 99 : 0;
  const total_cents = subtotal_cents + delivery_fee_cents + service_fee_cents;
  return {
    currency,
    subtotal_cents,
    delivery_fee_cents,
    service_fee_cents,
    total_cents,
    platform_fee_cents: delivery_fee_cents,
    seller_net_cents: Math.round(subtotal_cents * 0.9),
    driver_earning_cents: Math.round(delivery_fee_cents * 0.8),
  };
}

export type ParityHarnessResult = {
  gate: {
    stagingN: number;
    parityGatePct: number;
    passed: boolean;
  };
  metrics: ReturnType<typeof formatShadowMetricsReport>;
  journal: ReturnType<typeof summarizeShadowJournal>;
  byService: Record<string, { compared: number; equal: number; diff: number }>;
  chargePathStillLegacy: boolean;
  stripeCallsInShadow: number;
};

export async function runPhase2ParityHarness(
  targetN: number = STAGING_N
): Promise<ParityHarnessResult> {
  assert.equal(PRICING_ENGINE_MIGRATION_PHASE, 5);
  resetShadowMetricsForTests();
  clearShadowJournalForTests();

  const perService = Math.ceil(targetN / 4);
  const byService: Record<
    string,
    { compared: number; equal: number; diff: number }
  > = {
    food: { compared: 0, equal: 0, diff: 0 },
    package: { compared: 0, equal: 0, diff: 0 },
    ride: { compared: 0, equal: 0, diff: 0 },
    marketplace: { compared: 0, equal: 0, diff: 0 },
  };

  const runners: Array<() => Promise<void>> = [];

  for (let i = 0; i < perService; i += 1) {
    const food = foodScenario(i);
    runners.push(async () => {
      const report = await runPricingShadowCompare({
        legacyLatencyMs: 1 + (i % 5),
        buildPair: () => buildFoodComparablePair(food),
        deps: { persist: false, flagsOverride: shadowFlags, samplePct: 100 },
      });
      if (!report) throw new Error("food_shadow_null");
      byService.food.compared += 1;
      if (report.equal) byService.food.equal += 1;
      else byService.food.diff += 1;
    });

    const pkg = packageScenario(i);
    runners.push(async () => {
      const report = await runPricingShadowCompare({
        legacyLatencyMs: 1 + (i % 4),
        buildPair: () => buildPackageComparablePair(pkg),
        deps: { persist: false, flagsOverride: shadowFlags, samplePct: 100 },
      });
      if (!report) throw new Error("package_shadow_null");
      byService.package.compared += 1;
      if (report.equal) byService.package.equal += 1;
      else byService.package.diff += 1;
    });

    const ride = rideScenario(i);
    runners.push(async () => {
      const report = await runPricingShadowCompare({
        legacyLatencyMs: 1 + (i % 6),
        buildPair: () => buildRideComparablePair(ride),
        deps: { persist: false, flagsOverride: shadowFlags, samplePct: 100 },
      });
      if (!report) throw new Error("ride_shadow_null");
      byService.ride.compared += 1;
      if (report.equal) byService.ride.equal += 1;
      else byService.ride.diff += 1;
    });

    const mkt = marketplaceScenario(i);
    runners.push(async () => {
      const report = await runPricingShadowCompare({
        legacyLatencyMs: 1 + (i % 3),
        buildPair: () => buildMarketplaceComparablePair(mkt),
        deps: { persist: false, flagsOverride: shadowFlags, samplePct: 100 },
      });
      if (!report) throw new Error("marketplace_shadow_null");
      byService.marketplace.compared += 1;
      if (report.equal) byService.marketplace.equal += 1;
      else byService.marketplace.diff += 1;
    });
  }

  for (const run of runners) {
    await run();
  }

  const metrics = formatShadowMetricsReport();
  const journal = summarizeShadowJournal();
  const passed =
    metrics.compared >= targetN && metrics.parityPct >= PARITY_GATE_PCT;

  // Phase 5: defaults (canary 0 / services off) → all services legacy
  const defaultsStillLegacy =
    resolveChargePath(resolvePricingEngineFlags({}), "food") === "legacy" &&
    resolveChargePath(resolvePricingEngineFlags({}), "package") === "legacy" &&
    resolveChargePath(resolvePricingEngineFlags({}), "ride") === "legacy" &&
    resolveChargePath(resolvePricingEngineFlags({}), "marketplace") ===
      "legacy";

  // Phase 4 regression: marketplace blocked even with flags
  const marketplaceBlockedAtPhase4 =
    resolveChargePathForPhase(
      resolvePricingEngineFlags({
        PRICING_ENGINE_SERVICE_MARKETPLACE: "true",
        PRICING_ENGINE_CANARY_PCT: "100",
      }),
      "marketplace",
      4,
      { canaryKey: "x" }
    ) === "legacy";

  return {
    gate: {
      stagingN: targetN,
      parityGatePct: PARITY_GATE_PCT,
      passed,
    },
    metrics,
    journal,
    byService,
    chargePathStillLegacy: defaultsStillLegacy && marketplaceBlockedAtPhase4,
    stripeCallsInShadow: metrics.stripeCallsInShadow,
  };
}

async function main(): Promise<void> {
  const result = await runPhase2ParityHarness(STAGING_N);
  console.log(JSON.stringify(result, null, 2));
  assert.equal(result.chargePathStillLegacy, true);
  assert.equal(result.stripeCallsInShadow, 0);
  assert.ok(
    result.gate.passed,
    `parity gate failed: compared=${result.metrics.compared} parity=${result.metrics.parityPct}%`
  );
  console.log(
    `Phase 2 parity harness OK — ${result.metrics.compared} compares, ${result.metrics.parityPct}% parity`
  );
}

const isDirect =
  typeof process !== "undefined" &&
  process.argv[1] &&
  /phase2ParityHarness\.(ts|js|mjs|cjs)$/.test(
    process.argv[1].replace(/\\/g, "/")
  );

if (isDirect) {
  void main();
}
