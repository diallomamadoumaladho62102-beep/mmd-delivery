import assert from "node:assert/strict";
import {
  buildTaxiPricingPreviewBreakdown,
  estimateStripeUsCardFeeCents,
  formatTaxiMoney,
} from "./taxiPricingPreview";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("estimateStripeUsCardFeeCents uses 2.9% + 30¢", () => {
  assert.equal(estimateStripeUsCardFeeCents(10000), 320);
  assert.equal(estimateStripeUsCardFeeCents(0), 0);
});

test("preview uses RPC fields + service fee without inventing fare math", () => {
  const preview = buildTaxiPricingPreviewBreakdown({
    quote: {
      ok: true,
      currency: "USD",
      country_code: "US",
      vehicle_class: "standard",
      subtotal_cents: 2000,
      tax_cents: 160,
      platform_fee_cents: 500,
      driver_payout_cents: 1500,
      total_cents: 2160,
      distance_miles: 5,
      duration_minutes: 15,
    },
    serviceFeeCents: 100,
  });

  assert.equal(preview.customer_fare_cents, 2000);
  assert.equal(preview.service_fee_cents, 100);
  assert.equal(preview.tax_cents, 160);
  assert.equal(preview.customer_total_cents, 2260);
  assert.equal(preview.driver_earnings_cents, 1500);
  assert.equal(preview.platform_share_cents, 500);
  assert.equal(preview.mmd_platform_revenue_cents, 600);
  assert.equal(preview.stripe_fee_is_estimate, true);
  assert.equal(
    preview.stripe_fee_estimate_cents,
    estimateStripeUsCardFeeCents(2260)
  );
  assert.equal(
    preview.mmd_net_estimate_cents,
    600 - preview.stripe_fee_estimate_cents
  );
  assert.equal(preview.source.fare_engine, "quote_taxi_ride");
  assert.equal(
    preview.source.service_fee_engine,
    "applyTaxiServiceFeeToQuote"
  );
  assert.equal(formatTaxiMoney(2260, "USD"), "USD 22.60");
});

console.log("taxiPricingPreview tests passed");
