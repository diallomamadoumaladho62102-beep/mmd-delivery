/**
 * Phase 5B — Independence: Engine SoT, 0¢ parity, no legacy formula imports in adapters.
 * Run: pnpm exec tsx src/lib/pricingEngine/phase5b.independence.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFoodComparablePair } from "./engine/adapters/foodAdapter";
import { buildPackageComparablePair } from "./engine/adapters/packageAdapter";
import { buildRideComparablePair } from "./engine/adapters/rideAdapter";
import { buildMarketplaceComparablePair } from "./engine/adapters/marketplaceAdapter";
import { compareComparableQuotes } from "./shadow/compareQuotes";
import { computeDeliveryFeeV1 } from "./engine/compute/deliveryFeeV1";
import { computeTaxiFinalPrice } from "./engine/compute/taxiFinalPrice";
import {
  computeMarketplaceCheckoutTotals,
  computeMarketplaceDeliveryFeeCents,
} from "./engine/compute/marketplaceCheckout";
import { resolveChargePath, resolvePricingEngineFlags } from "./flags";
import type { FoodOrderPricingResult } from "../foodOrderServerPricing";

// --- Production defaults unchanged ---
assert.equal(
  resolveChargePath(resolvePricingEngineFlags({}), "food"),
  "legacy"
);
assert.equal(
  resolveChargePath(resolvePricingEngineFlags({}), "ride"),
  "legacy"
);

// --- PE compute goldens (parity with Phase 1 legacy goldens) ---
const peDel = computeDeliveryFeeV1({
  distanceMiles: 5,
  durationMinutes: 15,
});
assert.equal(peDel.deliveryFee, 9.25);
assert.equal(peDel.platformFee, 1.85);
assert.equal(peDel.driverPayout, 7.4);

const peTaxi = computeTaxiFinalPrice({
  subtotal_cents: 1000,
  tax_cents: 80,
  gross_total_cents: 1080,
});
assert.equal(peTaxi.total_cents, 1080);
assert.equal(peTaxi.total_discount_cents, 0);

assert.equal(computeMarketplaceDeliveryFeeCents(10000), 800);
assert.equal(computeMarketplaceDeliveryFeeCents(1000), 299);
const peMkt = computeMarketplaceCheckoutTotals({
  subtotal_cents: 10000,
  service_fee_cents: 0,
});
assert.equal(peMkt.total_cents, 10800);

// --- Adapter source: no legacy SoT formula imports ---
const adapterDir = join(__dirname, "engine", "adapters");
const forbiddenImportRe =
  /(?:^|\n)\s*import\s+(?!type\b)[^;]*from\s*["']@\/lib\/(deliveryPricing|taxiFinalPrice|marketplaceCheckout|foodOrderServerPricing)["']/;
for (const name of [
  "foodAdapter.ts",
  "packageAdapter.ts",
  "rideAdapter.ts",
  "marketplaceAdapter.ts",
]) {
  const src = readFileSync(join(adapterDir, name), "utf8");
  assert.equal(
    forbiddenImportRe.test(src),
    false,
    `${name} must not value-import legacy pricing SoT modules`
  );
  assert.match(src, /sot:\s*["']pricing-engine["']/, `${name} marks engine SoT`);
}

// --- Vertical parity 0¢ ---
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

function assertParity(
  label: string,
  pair: { legacy: { customerTotalCents: number }; engine: { customerTotalCents: number; meta?: Record<string, unknown> } }
) {
  const report = compareComparableQuotes({
    legacy: pair.legacy as never,
    engine: pair.engine as never,
    legacyLatencyMs: 1,
    engineLatencyMs: 1,
    compareId: `5b-${label}`,
  });
  assert.equal(report.equal, true, `${label}: ${JSON.stringify(report.fieldDiffs)}`);
  assert.equal(report.diffCents, 0, `${label} diffCents`);
  assert.equal(pair.engine.meta?.sot, "pricing-engine", `${label} sot`);
}

assertParity("food", buildFoodComparablePair(foodPricing));
assertParity(
  "package",
  buildPackageComparablePair({
    currency: "USD",
    subtotal: 0,
    tax: 0,
    deliveryFee: 9.25,
    serviceFee: 0,
    discounts: 0,
    totalCents: 925,
    driverPayoutEstimate: 7.4,
    deliveryFeeRaw: 9.25,
    distanceMiles: 5,
    etaMinutes: 15,
  })
);
assertParity(
  "ride",
  buildRideComparablePair({
    currency: "USD",
    subtotal_cents: 1000,
    tax_cents: 80,
    service_fee_cents: 0,
    platform_fee_cents: 250,
    driver_payout_cents: 750,
    total_cents: 1080,
  })
);
assertParity(
  "marketplace",
  buildMarketplaceComparablePair({
    currency: "USD",
    subtotal_cents: 10000,
    delivery_fee_cents: 800,
    service_fee_cents: 0,
    total_cents: 10800,
  })
);

// Shared-ride PE formula (engine-owned)
const shared = computeTaxiFinalPrice({
  subtotal_cents: 1000,
  tax_cents: 0,
  gross_total_cents: 1000,
  shared_ride: true,
});
assert.equal(shared.shared_discount_cents, 150);
assert.equal(shared.total_cents, 850);

console.log("pricingEngine Phase 5B independence OK");
