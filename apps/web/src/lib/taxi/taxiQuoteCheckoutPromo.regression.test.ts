import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { quoteRideFinalSot } from "@/lib/pricingEngine";
import { snapshotFromRideRow } from "@/lib/taxiFinalPrice";
import { splitTaxiNetCommissionCents } from "./taxiQuoteCheckoutDiscounts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '../../..');
const repoRoot = path.resolve(webRoot, '../..');

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

function quoteShares(subtotal: number, driverPct: number, platformPct: number) {
  const driver = Math.round((subtotal * driverPct) / 100);
  const platform = Math.round((subtotal * platformPct) / 100);
  return { driver, platform };
}

function assertMoneyIdentity(
  split: { driver_payout_cents: number; platform_fee_cents: number },
  customerNet: number,
  tax: number,
) {
  assert.equal(
    split.driver_payout_cents + split.platform_fee_cents + tax,
    customerNet,
  );
  assert.ok(split.driver_payout_cents <= Math.max(0, customerNet - tax));
}

test("no promo: driver keeps quote share; tax+service fee stay with MMD", () => {
  const split = splitTaxiNetCommissionCents({
    customerNetTotalCents: 1130,
    quoteDriverPayoutCents: 750,
    quotePlatformFeeCents: 250,
    subtotalCents: 1000,
    serviceFeeCents: 50,
    taxCents: 80,
    discountCents: 0,
  });
  assert.equal(split.driver_payout_cents, 750);
  assert.equal(split.platform_fee_cents, 300);
  assertMoneyIdentity(split, 1130, 80);
});

test("promo: discounts reduce fare only", () => {
  const split = splitTaxiNetCommissionCents({
    customerNetTotalCents: 930,
    quoteDriverPayoutCents: 750,
    quotePlatformFeeCents: 250,
    subtotalCents: 1000,
    serviceFeeCents: 50,
    taxCents: 80,
    discountCents: 200,
  });
  assert.equal(split.driver_payout_cents, 600);
  assert.equal(split.platform_fee_cents, 250);
  assertMoneyIdentity(split, 930, 80);
});

test("service fee only: 100% MMD", () => {
  const split = splitTaxiNetCommissionCents({
    customerNetTotalCents: 1050,
    quoteDriverPayoutCents: 750,
    quotePlatformFeeCents: 250,
    subtotalCents: 1000,
    serviceFeeCents: 50,
    taxCents: 0,
    discountCents: 0,
  });
  assert.equal(split.driver_payout_cents, 750);
  assert.equal(split.platform_fee_cents, 300);
  assertMoneyIdentity(split, 1050, 0);
});

test("tax only: pass-through", () => {
  const split = splitTaxiNetCommissionCents({
    customerNetTotalCents: 1080,
    quoteDriverPayoutCents: 750,
    quotePlatformFeeCents: 250,
    subtotalCents: 1000,
    serviceFeeCents: 0,
    taxCents: 80,
    discountCents: 0,
  });
  assert.equal(split.driver_payout_cents, 750);
  assert.equal(split.platform_fee_cents, 250);
  assertMoneyIdentity(split, 1080, 80);
});

test("Standard 75/25", () => {
  const subtotal = 2000;
  const { driver, platform } = quoteShares(subtotal, 75, 25);
  const tax = 160;
  const service = 100;
  const customer = subtotal + tax + service;
  const split = splitTaxiNetCommissionCents({
    customerNetTotalCents: customer,
    quoteDriverPayoutCents: driver,
    quotePlatformFeeCents: platform,
    subtotalCents: subtotal,
    serviceFeeCents: service,
    taxCents: tax,
    discountCents: 0,
  });
  assert.equal(split.driver_payout_cents, 1500);
  assert.equal(split.platform_fee_cents, 600);
  assertMoneyIdentity(split, customer, tax);
});

test("XL 70/30", () => {
  const subtotal = 3000;
  const { driver, platform } = quoteShares(subtotal, 70, 30);
  const tax = 240;
  const service = 150;
  const customer = subtotal + tax + service;
  const split = splitTaxiNetCommissionCents({
    customerNetTotalCents: customer,
    quoteDriverPayoutCents: driver,
    quotePlatformFeeCents: platform,
    subtotalCents: subtotal,
    serviceFeeCents: service,
    taxCents: tax,
    discountCents: 0,
  });
  assert.equal(split.driver_payout_cents, 2100);
  assert.equal(split.platform_fee_cents, 1050);
  assertMoneyIdentity(split, customer, tax);
});

test("Premium 65/35", () => {
  const subtotal = 4000;
  const { driver, platform } = quoteShares(subtotal, 65, 35);
  const tax = 320;
  const service = 200;
  const customer = subtotal + tax + service;
  const split = splitTaxiNetCommissionCents({
    customerNetTotalCents: customer,
    quoteDriverPayoutCents: driver,
    quotePlatformFeeCents: platform,
    subtotalCents: subtotal,
    serviceFeeCents: service,
    taxCents: tax,
    discountCents: 0,
  });
  assert.equal(split.driver_payout_cents, 2600);
  assert.equal(split.platform_fee_cents, 1600);
  assertMoneyIdentity(split, customer, tax);
});

test("share gap: remainder to MMD", () => {
  const subtotal = 1000;
  const { driver, platform } = quoteShares(subtotal, 75, 20);
  const tax = 80;
  const service = 50;
  const customer = subtotal + tax + service;
  const split = splitTaxiNetCommissionCents({
    customerNetTotalCents: customer,
    quoteDriverPayoutCents: driver,
    quotePlatformFeeCents: platform,
    subtotalCents: subtotal,
    serviceFeeCents: service,
    taxCents: tax,
    discountCents: 0,
  });
  assert.equal(split.driver_payout_cents, 750);
  assert.equal(split.platform_fee_cents, 300);
  assertMoneyIdentity(split, customer, tax);
});

test("checkout matches recalculate unpaid formula", () => {
  const subtotal = 1000;
  const driverPct = 75;
  const quoteDriver = Math.round((subtotal * driverPct) / 100);
  const quotePlatform = Math.round((subtotal * 25) / 100);
  const discount = 200;
  const tax = 80;
  const service = 50;
  const fareNet = subtotal - discount;
  const customer = fareNet + tax + service;
  const recalcDriver = Math.round((fareNet * driverPct) / 100);
  const split = splitTaxiNetCommissionCents({
    customerNetTotalCents: customer,
    quoteDriverPayoutCents: quoteDriver,
    quotePlatformFeeCents: quotePlatform,
    subtotalCents: subtotal,
    serviceFeeCents: service,
    taxCents: tax,
    discountCents: discount,
  });
  assert.equal(split.driver_payout_cents, recalcDriver);
  assert.equal(split.driver_payout_cents, 600);
});

test("driver never receives tax if platform share is zero", () => {
  const split = splitTaxiNetCommissionCents({
    customerNetTotalCents: 1130,
    quoteDriverPayoutCents: 1000,
    quotePlatformFeeCents: 0,
    subtotalCents: 1000,
    serviceFeeCents: 50,
    taxCents: 80,
    discountCents: 0,
  });
  assert.equal(split.driver_payout_cents, 1000);
  assert.equal(split.platform_fee_cents, 50);
  assert.ok(split.driver_payout_cents <= 1130 - 80);
});

test("promo discount folds into PE net total", () => {
  const priced = quoteRideFinalSot({
    subtotal_cents: 1000,
    tax_cents: 0,
    gross_total_cents: 1000,
    promo_discount_cents: 200,
    mmd_plus_discount_cents: 0,
  });
  assert.equal(priced.total_cents, 800);
  assert.equal(priced.promo_discount_cents, 200);
});

test("marketing discount in ride snapshot integrity", () => {
  const snap = snapshotFromRideRow({
    subtotal_cents: 1000,
    tax_cents: 0,
    gross_total_cents: 1000,
    discount_cents: 100,
    marketing_discount_cents: 50,
    mmd_plus_discount_cents: 0,
  });
  assert.equal(snap.total_cents, 850);
});

test("checkout route wires SoT commission args", () => {
  const src = fs.readFileSync(path.join(webRoot, "app/api/stripe/client/create-taxi-quote-checkout-session/route.ts"), "utf8");
  assert.match(src, /resolveTaxiCheckoutDiscounts/);
  assert.match(src, /quoteDriverPayoutCents/);
  assert.match(src, /subtotalCents:/);
  assert.match(src, /taxCents:/);
  assert.match(src, /discountCents:/);
  assert.match(src, /serviceFeeCents:/);
  assert.match(src, /promo_discount_cents: discounts\.promo_discount_cents/);
});

test("materialize finalizes promo only after paid ride", () => {
  const materialize = fs.readFileSync(path.join(webRoot, "src/lib/taxi/taxiCheckoutFromQuote.ts"), "utf8");
  const discounts = fs.readFileSync(path.join(webRoot, "src/lib/taxi/taxiQuoteCheckoutDiscounts.ts"), "utf8");
  assert.match(materialize, /finalizeTaxiPromotionAfterPaidMaterialize/);
  assert.match(materialize, /payment_status:\s*["']paid["']/);
  assert.match(discounts, /finalize_taxi_promotion_redemption/);
  assert.match(discounts, /validate_taxi_promotion/);
  assert.match(discounts, /Failed \/ abandoned Checkout never reaches this path/);
});

test("promo finalize idempotent per ride", () => {
  const mig = fs.readFileSync(path.join(repoRoot, "supabase/migrations/20260612120000_taxi_premium_sprint1.sql"), "utf8");
  assert.match(mig, /taxi_promotion_redemptions_ride_uq unique \(taxi_ride_id\)/);
  assert.match(mig, /already.*true/);
  assert.match(mig, /finalize_taxi_promotion_redemption/);
});

test("recalculate freezes paid rides; fare-only split", () => {
  const mig = fs.readFileSync(path.join(repoRoot, "supabase/migrations/20261124160000_taxi_money_split_sot_closure.sql"), "utf8");
  assert.match(mig, /paid_ride_totals_frozen/);
  assert.match(mig, /payment_status.*paid/);
  assert.match(mig, /v_fare_net/);
  assert.match(mig, /service_fee_cents/);
  assert.match(mig, /skipped_paid/);
  assert.match(mig, /apply_taxi_shared_ride_discounts/);
  assert.match(mig, /mmd_plus_discount_cents/);
  assert.match(mig, /marketing_discount_cents/);
});

test("recalculate has no hardcoded 75% driver share fallback", () => {
  const mig = fs.readFileSync(
    path.join(
      repoRoot,
      "supabase/migrations/20261125120000_taxi_recalculate_no_hardcoded_share.sql",
    ),
    "utf8",
  );
  assert.doesNotMatch(mig, /v_driver_share numeric := 75/);
  assert.match(mig, /driver_share_unresolved/);
});

test("legacy create path uses same splitTaxiNetCommissionCents SoT", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "app/api/taxi/rides/create/route.ts"),
    "utf8",
  );
  assert.match(src, /splitTaxiNetCommissionCents/);
  assert.match(src, /discountCents: initialDiscountCents/);
  assert.match(src, /driver_payout_cents: nextCommission\.driver_payout_cents/);
  assert.match(src, /usesLocalMobileMoney/);
  assert.match(src, /use_quote_checkout/);
});

test("Connect credit from driver_payout; transfer idempotent", () => {
  const materialize = fs.readFileSync(path.join(webRoot, "src/lib/taxi/taxiCheckoutFromQuote.ts"), "utf8");
  const transfer = fs.readFileSync(path.join(webRoot, "src/lib/finance/executeTaxiDriverFareTransfer.ts"), "utf8");
  const guards = fs.readFileSync(path.join(webRoot, "src/lib/finance/taxiFareTransferGuards.ts"), "utf8");
  assert.match(materialize, /partnerCents: Math\.round\(Number\(ride\.driver_payout_cents/);
  assert.match(transfer, /taxi_commissions/);
  assert.match(transfer, /driver_paid_out/);
  assert.match(transfer, /buildTaxiFareTransferIdempotencyKey/);
  assert.match(guards, /taxi_driver_payout:\$\{id\}/);
});

test("refresh_taxi_commissions freezes after payout", () => {
  const mig = fs.readFileSync(path.join(repoRoot, "supabase/migrations/20261119120000_taxi_commission_sct_legacy_closure.sql"), "utf8");
  assert.match(mig, /commission_frozen_after_payout_or_legacy_closure/);
  assert.match(mig, /driver_paid_out/);
  assert.match(mig, /driver_cents = excluded\.driver_cents/);
});

console.log("taxiQuoteCheckoutPromo.regression passed");
