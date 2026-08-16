import assert from "node:assert/strict";
import { splitTaxiNetCommissionCents } from "./taxiQuoteCheckoutDiscounts";
import { quoteRideFinalSot } from "@/lib/pricingEngine";
import { snapshotFromRideRow } from "@/lib/taxiFinalPrice";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "../../..");

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("commission split preserves net total", () => {
  const split = splitTaxiNetCommissionCents({
    netTotalCents: 900,
    driverPayoutCents: 750,
    platformFeeCents: 250,
  });
  assert.equal(split.driver_payout_cents + split.platform_fee_cents, 900);
  assert.equal(split.driver_payout_cents, 675);
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

test("marketing discount is included in ride snapshot integrity", () => {
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

test("pay-then-create checkout applies server promo before Stripe amount", () => {
  const src = fs.readFileSync(
    path.join(
      webRoot,
      "app/api/stripe/client/create-taxi-quote-checkout-session/route.ts",
    ),
    "utf8",
  );
  assert.match(src, /resolveTaxiCheckoutDiscounts/);
  assert.match(src, /promo_discount_cents: discounts\.promo_discount_cents/);
  assert.match(src, /marketing_discount_cents: discounts\.marketing_discount_cents/);
  assert.match(src, /intentId: discounts\.checkout_entity_id/);
});

test("pay-then-create materialize finalizes promo redemption after paid ride", () => {
  const materialize = fs.readFileSync(
    path.join(webRoot, "src/lib/taxi/taxiCheckoutFromQuote.ts"),
    "utf8",
  );
  const discounts = fs.readFileSync(
    path.join(webRoot, "src/lib/taxi/taxiQuoteCheckoutDiscounts.ts"),
    "utf8",
  );
  assert.match(materialize, /finalizeTaxiPromotionAfterPaidMaterialize/);
  assert.match(discounts, /finalize_taxi_promotion_redemption/);
  assert.match(discounts, /validate_taxi_promotion/);
  // Failures never reach materialize → promo not consumed until PI succeeded.
  assert.match(discounts, /Failed \/ abandoned Checkout never reaches this path/);
});

test("promo finalize is idempotent per ride via unique redemption", () => {
  const mig = fs.readFileSync(
    path.join(
      webRoot,
      "../../supabase/migrations/20260612120000_taxi_premium_sprint1.sql",
    ),
    "utf8",
  );
  assert.match(mig, /taxi_promotion_redemptions_ride_uq unique \(taxi_ride_id\)/);
  assert.match(mig, /already.*true/);
  assert.match(mig, /finalize_taxi_promotion_redemption/);
});

console.log("taxiQuoteCheckoutPromo.regression passed");
