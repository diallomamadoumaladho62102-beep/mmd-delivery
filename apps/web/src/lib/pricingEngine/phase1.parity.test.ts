/**
 * Phase 1 parity — business defaults must match legacy hardcoded values
 * and keep delivery / wait / marketplace / taxi math unchanged.
 */
import assert from "node:assert/strict";
import {
  PRICING_BUSINESS_DEFAULTS,
  getPricingBusinessDefaults,
} from "./config/businessDefaults";
import {
  DEFAULT_DELIVERY_PRICING_CONFIG,
  computeDeliveryPricing,
} from "../deliveryPricing";
import { FOOD_LEGACY_TAX_RATE } from "../foodOrderClientPricingGuard";
import { TAXI_SHARED_RIDE_DISCOUNT_PERCENT } from "../taxiSharedRideDispatch";
import {
  QUOTE_DRIFT_TOLERANCE_CENTS,
  QUOTE_DRIFT_TOLERANCE_RATIO,
  calculateTaxiFinalPriceSnapshot,
} from "../taxiFinalPrice";
import {
  WAIT_TIMER_FREE_MINUTES,
  WAIT_FEE_TIER1_RATE_CENTS,
  WAIT_FEE_MAX_CENTS,
} from "../waitTimerTypes";
import { computeWaitFeeCents } from "../waitFeeCalculator";
import { computeMarketplaceCheckoutShadow } from "../marketplaceCheckout";
import { calculateCustomerDeliveryPrice } from "../deliveryPricingEngine/calculateCustomerDeliveryPrice";
import { calculateDriverDeliveryEarning } from "../deliveryPricingEngine/calculateDriverDeliveryEarning";
import { MIN_RESIDUAL_CHARGE_CENTS } from "../loyalty/loyaltyProgram";
import { DRIVER_CASHOUT_MINIMUM_CENTS } from "../driverWalletService";
import { PRICING_ENGINE_MIGRATION_PHASE } from "./phaseGate";
import { resolveChargePath, resolvePricingEngineFlags } from "./flags";

assert.equal(PRICING_ENGINE_MIGRATION_PHASE, 5);
assert.equal(resolveChargePath(resolvePricingEngineFlags({}), "food"), "legacy");

// --- Exact legacy values ---
assert.equal(PRICING_BUSINESS_DEFAULTS.delivery_base_fare, 2.5);
assert.equal(PRICING_BUSINESS_DEFAULTS.delivery_per_mile, 0.9);
assert.equal(PRICING_BUSINESS_DEFAULTS.delivery_per_minute, 0.15);
assert.equal(PRICING_BUSINESS_DEFAULTS.delivery_min_fare, 3.49);
assert.equal(PRICING_BUSINESS_DEFAULTS.delivery_driver_share_pct, 80);
assert.equal(PRICING_BUSINESS_DEFAULTS.delivery_platform_share_pct, 20);
assert.equal(PRICING_BUSINESS_DEFAULTS.food_legacy_tax_rate, 0.0888);
assert.equal(PRICING_BUSINESS_DEFAULTS.taxi_shared_ride_discount_percent, 15);
assert.equal(PRICING_BUSINESS_DEFAULTS.marketplace_delivery_fee_floor_cents, 299);
assert.equal(PRICING_BUSINESS_DEFAULTS.marketplace_delivery_fee_pct, 0.08);
assert.equal(PRICING_BUSINESS_DEFAULTS.taxi_no_show_compensation_pct, 0.05);
assert.equal(PRICING_BUSINESS_DEFAULTS.wait_fee_max_cents, 225);
assert.equal(PRICING_BUSINESS_DEFAULTS.driver_cashout_minimum_cents, 2000);

assert.equal(DEFAULT_DELIVERY_PRICING_CONFIG.baseFare, 2.5);
assert.equal(FOOD_LEGACY_TAX_RATE, 0.0888);
assert.equal(TAXI_SHARED_RIDE_DISCOUNT_PERCENT, 15);
assert.equal(QUOTE_DRIFT_TOLERANCE_CENTS, 50);
assert.equal(QUOTE_DRIFT_TOLERANCE_RATIO, 0.02);
assert.equal(WAIT_TIMER_FREE_MINUTES, 5);
assert.equal(WAIT_FEE_TIER1_RATE_CENTS, 25);
assert.equal(WAIT_FEE_MAX_CENTS, 225);
assert.equal(MIN_RESIDUAL_CHARGE_CENTS, 50);
assert.equal(DRIVER_CASHOUT_MINIMUM_CENTS, 2000);

// Delivery V1 golden (5 mi, 15 min): raw = 2.5+4.5+2.25 = 9.25
const v1 = computeDeliveryPricing(
  { distanceMiles: 5, durationMinutes: 15 },
  DEFAULT_DELIVERY_PRICING_CONFIG
);
assert.equal(v1.deliveryFee, 9.25);
assert.equal(v1.platformFee, 1.85);
assert.equal(v1.driverPayout, 7.4);

// Wait fee: 8 billable minutes → 3*25 + 5*30 = 225 capped
assert.equal(computeWaitFeeCents(8), 225);
assert.equal(computeWaitFeeCents(2), 50);

// Taxi shared discount 15% of 10000 = 1500
const taxi = calculateTaxiFinalPriceSnapshot({
  subtotal_cents: 9000,
  tax_cents: 1000,
  gross_total_cents: 10000,
  shared_ride: true,
});
assert.equal(taxi.shared_discount_cents, 1500);
assert.equal(taxi.total_cents, 8500);

// Marketplace: subtotal 10000 → max(299, 800) = 800
const mkt = computeMarketplaceCheckoutShadow(
  [{ price_cents: 5000, quantity: 2 }],
  { serviceFeeConfig: { enabled: false, pct: 0, fixedCents: 0 } }
);
assert.equal(mkt.subtotal_cents, 10000);
assert.equal(mkt.delivery_fee_cents, 800);

// Marketplace floor: subtotal 1000 → max(299, 80) = 299
const mktFloor = computeMarketplaceCheckoutShadow(
  [{ price_cents: 1000, quantity: 1 }],
  { serviceFeeConfig: { enabled: false, pct: 0, fixedCents: 0 } }
);
assert.equal(mktFloor.delivery_fee_cents, 299);

// V2 customer shadow parity
const v2c = calculateCustomerDeliveryPrice({
  distanceMiles: 5,
  durationMinutes: 15,
});
// (2.5 + 15*0.15 + 5*0.9 + 0.99) * 1 = 2.5+2.25+4.5+0.99 = 10.24 → max(3.49,10.24)
assert.equal(v2c.totalCents, 1024);

// V2 driver earning base path (defaults score/ranking/demand)
const v2d = calculateDriverDeliveryEarning({
  distanceMiles: 5,
  durationMinutes: 15,
});
assert.ok(v2d.earningCents > 0);

const d = getPricingBusinessDefaults();
assert.equal(d.delivery_v2_driver_per_mile, 0.72);

console.log("pricingEngine Phase 1 parity OK");
