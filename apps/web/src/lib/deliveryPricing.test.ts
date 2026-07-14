import assert from "node:assert/strict";
import {
  assertDeliveryFeeNotAbnormal,
  assertDeliverySharePctValid,
  assertQuoteMatchesStripeAmount,
  computeDeliveryPricing,
  DeliveryPricingConfigError,
  DELIVERY_SHARE_PCT_INVALID_CODE,
  evaluateDeliveryFeeAbnormality,
  explainDeliveryFee,
  normalizeDeliveryPricingConfig,
  normalizeSharePctScale,
  round2,
} from "./deliveryPricing";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

function expectThrows(fn: () => void, codeOrMessage: string) {
  try {
    fn();
    throw new Error("expected throw");
  } catch (error) {
    if (error instanceof Error && error.message === "expected throw") throw error;
    const message = error instanceof Error ? error.message : String(error);
    const code =
      error instanceof DeliveryPricingConfigError ? error.code : "";
    if (!message.includes(codeOrMessage) && code !== codeOrMessage) {
      throw new Error(
        `Expected error containing "${codeOrMessage}", got code=${code} message=${message}`
      );
    }
  }
}

test("70 + 30 = valid", () => {
  const cfg = normalizeDeliveryPricingConfig({
    driverSharePct: 70,
    platformSharePct: 30,
  });
  assert.equal(cfg.driverSharePct, 70);
  assert.equal(cfg.platformSharePct, 30);
  assertDeliverySharePctValid(70, 30);
});

test("80 + 20 = valid", () => {
  const cfg = normalizeDeliveryPricingConfig({
    driverSharePct: 80,
    platformSharePct: 20,
  });
  assert.equal(cfg.driverSharePct, 80);
  assert.equal(cfg.platformSharePct, 20);
});

test("80 + 25 = rejected", () => {
  expectThrows(
    () =>
      normalizeDeliveryPricingConfig({
        driverSharePct: 80,
        platformSharePct: 25,
      }),
    DELIVERY_SHARE_PCT_INVALID_CODE
  );
  expectThrows(() => assertDeliverySharePctValid(80, 25), "must be <= 100");
});

test("decimal share values are accepted when sum <= 100", () => {
  const cfg = normalizeDeliveryPricingConfig({
    driverSharePct: 72.5,
    platformSharePct: 27.5,
  });
  assert.equal(cfg.driverSharePct, 72.5);
  assert.equal(cfg.platformSharePct, 27.5);
  const pricing = computeDeliveryPricing(
    { distanceMiles: 5, durationMinutes: 15 },
    cfg
  );
  assert.equal(round2(pricing.platformFee + pricing.driverPayout), pricing.deliveryFee);
});

test("nullish shares fall back to defaults 80/20", () => {
  const cfg = normalizeDeliveryPricingConfig({});
  assert.equal(cfg.driverSharePct, 80);
  assert.equal(cfg.platformSharePct, 20);
});

test("0–1 fractions are converted to 0–100", () => {
  assert.equal(normalizeSharePctScale(0.8), 80);
  assert.equal(normalizeSharePctScale(0.2), 20);
  assert.equal(normalizeSharePctScale(0.25), 25);
  assert.equal(normalizeSharePctScale(80), 80);
  assert.equal(normalizeSharePctScale(null), null);
  assert.equal(normalizeSharePctScale(""), null);

  const cfg = normalizeDeliveryPricingConfig({
    driverSharePct: 0.8,
    platformSharePct: 0.2,
  });
  assert.equal(cfg.driverSharePct, 80);
  assert.equal(cfg.platformSharePct, 20);
});

test("legacy invalid config: only platformSharePct=30 no longer forces default driver 80", () => {
  // Reproduces the production bug: Admin saved 70/30 but loader only passed platform=30.
  const cfg = normalizeDeliveryPricingConfig({
    platformSharePct: 30,
  });
  assert.equal(cfg.platformSharePct, 30);
  assert.equal(cfg.driverSharePct, 70);
  const pricing = computeDeliveryPricing(
    { distanceMiles: 3, durationMinutes: 12 },
    cfg
  );
  assert.ok(pricing.deliveryFee > 0);
});

test("legacy invalid config 80+25 still rejected when both provided", () => {
  expectThrows(
    () =>
      normalizeDeliveryPricingConfig({
        driverSharePct: 80,
        platformSharePct: 25,
      }),
    "must be <= 100"
  );
});

test("restaurant/vendor percentages are not part of delivery share math", () => {
  // Simulates the wrong mental model of adding restaurant_pct into the delivery pair.
  // Delivery engine only knows driverSharePct + platformSharePct.
  const cfg = normalizeDeliveryPricingConfig({
    driverSharePct: 80,
    platformSharePct: 20,
  });
  const pricing = computeDeliveryPricing(
    { distanceMiles: 2, durationMinutes: 8 },
    cfg
  );
  assert.equal(round2(pricing.platformFee + pricing.driverPayout), pricing.deliveryFee);
  // Even if someone had restaurant_pct=85, it must not affect this split.
  assert.equal(cfg.driverSharePct + cfg.platformSharePct, 100);
});

test("abnormally high delivery fee on short trip is flagged", () => {
  const result = evaluateDeliveryFeeAbnormality(
    45,
    { distanceMiles: 0.5, durationMinutes: 5 },
    { baseFare: 2.5, perMile: 0.9, perMinute: 0.15, minFare: 0 }
  );
  // Engine expectation for 0.5mi/5min is ~3.7, so fee_mismatch_vs_engine
  assert.equal(result.abnormal, true);
  assert.equal(result.reason, "fee_mismatch_vs_engine");

  expectThrows(
    () =>
      assertDeliveryFeeNotAbnormal(
        45,
        { distanceMiles: 0.5, durationMinutes: 5 },
        { baseFare: 2.5, perMile: 0.9, perMinute: 0.15, minFare: 0 }
      ),
    "delivery_fee_abnormal"
  );
});

test("25.44 USD delivery fee matches long-distance miles/minutes formula (not cart subtotal)", () => {
  // 2.5 + 20*0.9 + 33*0.15 = 2.5 + 18 + 4.95 = 25.45 ≈ observed 25.44
  const explained = explainDeliveryFee(
    { distanceMiles: 20, durationMinutes: 32.93 },
    { baseFare: 2.5, perMile: 0.9, perMinute: 0.15, minFare: 0 }
  );
  assert.ok(Math.abs(explained.deliveryFee - 25.44) < 0.02);
  assert.match(explained.note, /independent of food subtotal/i);

  // Cart subtotal 7.66 does not enter the delivery engine.
  const pricing = computeDeliveryPricing(
    { distanceMiles: 20, durationMinutes: 32.93 },
    {
      baseFare: 2.5,
      perMile: 0.9,
      perMinute: 0.15,
      minFare: 0,
      driverSharePct: 80,
      platformSharePct: 20,
    }
  );
  assert.ok(Math.abs(pricing.deliveryFee - 25.44) < 0.02);
  assert.equal(round2(pricing.platformFee + pricing.driverPayout), pricing.deliveryFee);
});

test("quote / Stripe / order total cents consistency", () => {
  const quoteTotal = 33.78; // 7.66 + 0.68 + 25.44 + 0 service
  const stripeAmountCents = 3378;
  const orderTotalCents = 3378;
  assertQuoteMatchesStripeAmount({
    quoteTotal,
    stripeAmountCents,
    orderTotalCents,
  });

  expectThrows(
    () =>
      assertQuoteMatchesStripeAmount({
        quoteTotal: 33.78,
        stripeAmountCents: 3400,
        orderTotalCents: 3378,
      }),
    "quote_stripe_mismatch"
  );

  expectThrows(
    () =>
      assertQuoteMatchesStripeAmount({
        quoteTotal: 33.78,
        stripeAmountCents: 3378,
        orderTotalCents: 3500,
      }),
    "quote_order_mismatch"
  );
});

test("Mapbox meters→miles conversion basis (no km-as-miles)", () => {
  const meters = 32186.8; // ~20 miles
  const miles = Number((meters / 1609.34).toFixed(2));
  assert.equal(miles, 20);
  // If someone wrongly treated meters as miles, fee would explode.
  const wrong = evaluateDeliveryFeeAbnormality(
    computeDeliveryPricing(
      { distanceMiles: meters, durationMinutes: 33 },
      { baseFare: 2.5, perMile: 0.9, perMinute: 0.15, minFare: 0 }
    ).deliveryFee,
    { distanceMiles: 20, durationMinutes: 33 },
    { baseFare: 2.5, perMile: 0.9, perMinute: 0.15, minFare: 0 }
  );
  assert.equal(wrong.abnormal, true);
});

console.log("deliveryPricing.test.ts OK");
