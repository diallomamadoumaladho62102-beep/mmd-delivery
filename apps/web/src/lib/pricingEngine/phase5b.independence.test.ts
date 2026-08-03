/**
 * Phase 6 — PE compute independence (legacy adapters removed).
 * Run: pnpm exec tsx src/lib/pricingEngine/phase5b.independence.test.ts
 */
import assert from "node:assert/strict";
import { computeDeliveryFeeV1 } from "./engine/compute/deliveryFeeV1";
import { computeTaxiFinalPrice } from "./engine/compute/taxiFinalPrice";
import {
  computeMarketplaceCheckoutTotals,
  computeMarketplaceDeliveryFeeCents,
} from "./engine/compute/marketplaceCheckout";
import { PRICING_ENGINE_MIGRATION_PHASE } from "./phaseGate";
import {
  assembleFoodPackageCustomerTotalCents,
} from "./engine/compute/foodPackageTotals";

assert.equal(PRICING_ENGINE_MIGRATION_PHASE, 6);

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

const foodTotal = assembleFoodPackageCustomerTotalCents({
  subtotalAfterDiscount: 20,
  tax: 1.6,
  deliveryFee: 5,
  serviceFee: 1,
});
assert.equal(foodTotal, 2760);

console.log("pricingEngine Phase 5B/6 independence OK", {
  migrationPhase: PRICING_ENGINE_MIGRATION_PHASE,
  deliveryFee: peDel.deliveryFee,
  taxiTotal: peTaxi.total_cents,
  marketplaceTotal: peMkt.total_cents,
});
