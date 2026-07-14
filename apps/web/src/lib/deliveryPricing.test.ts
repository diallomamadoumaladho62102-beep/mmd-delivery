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
  metersToMiles,
  METERS_PER_MILE,
  normalizeDeliveryPricingConfig,
  normalizeSharePctScale,
  requireDeliverySharePctPair,
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

test("config 70/30 is valid", () => {
  const cfg = normalizeDeliveryPricingConfig({
    driverSharePct: 70,
    platformSharePct: 30,
  });
  assert.equal(cfg.driverSharePct, 70);
  assert.equal(cfg.platformSharePct, 30);
  const pricing = computeDeliveryPricing(
    { distanceMiles: 4, durationMinutes: 12 },
    cfg
  );
  assert.equal(round2(pricing.platformFee + pricing.driverPayout), pricing.deliveryFee);
});

test("config 80/20 is valid", () => {
  const cfg = normalizeDeliveryPricingConfig({
    driverSharePct: 80,
    platformSharePct: 20,
  });
  assert.equal(cfg.driverSharePct, 80);
  assert.equal(cfg.platformSharePct, 20);
});

test("config 75/25 is valid", () => {
  const cfg = normalizeDeliveryPricingConfig({
    driverSharePct: 75,
    platformSharePct: 25,
  });
  assert.equal(cfg.driverSharePct, 75);
  assert.equal(cfg.platformSharePct, 25);
  assertDeliverySharePctValid(75, 25);
});

test("config 80/30 is refused", () => {
  expectThrows(
    () =>
      normalizeDeliveryPricingConfig({
        driverSharePct: 80,
        platformSharePct: 30,
      }),
    DELIVERY_SHARE_PCT_INVALID_CODE
  );
  expectThrows(() => assertDeliverySharePctValid(80, 30), "must be <= 100");
});

test("driver absent is refused (no silent default pairing)", () => {
  expectThrows(
    () =>
      normalizeDeliveryPricingConfig({
        platformSharePct: 30,
      }),
    "provided together"
  );
  expectThrows(
    () =>
      requireDeliverySharePctPair({
        delivery_driver_pct: null,
        delivery_platform_pct: 30,
        configKey: "food_default",
      }),
    DELIVERY_SHARE_PCT_INVALID_CODE
  );
});

test("platform absent is refused (no silent default pairing)", () => {
  expectThrows(
    () =>
      normalizeDeliveryPricingConfig({
        driverSharePct: 70,
      }),
    "provided together"
  );
  expectThrows(
    () =>
      requireDeliverySharePctPair({
        delivery_driver_pct: 70,
        delivery_platform_pct: null,
        configKey: "errand_default",
      }),
    "incomplete"
  );
});

test("ancienne config partielle (only platform from Admin) is refused", () => {
  // Reproduces the production bug class: Admin saved 70/30 but loader only
  // forwarded platform=30 → would have become 80/30 with silent defaults.
  expectThrows(
    () =>
      normalizeDeliveryPricingConfig({
        platformSharePct: 30,
      }),
    DELIVERY_SHARE_PCT_INVALID_CODE
  );
  expectThrows(
    () =>
      requireDeliverySharePctPair({
        delivery_driver_pct: undefined,
        delivery_platform_pct: 30,
      }),
    "incomplete"
  );
});

test("decimal share values are accepted when sum <= 100", () => {
  const cfg = normalizeDeliveryPricingConfig({
    driverSharePct: 72.5,
    platformSharePct: 27.5,
  });
  assert.equal(cfg.driverSharePct, 72.5);
  assert.equal(cfg.platformSharePct, 27.5);
});

test("0–1 fractions are converted to 0–100 when both present", () => {
  assert.equal(normalizeSharePctScale(0.8), 80);
  assert.equal(normalizeSharePctScale(0.2), 20);
  const cfg = normalizeDeliveryPricingConfig({
    driverSharePct: 0.8,
    platformSharePct: 0.2,
  });
  assert.equal(cfg.driverSharePct, 80);
  assert.equal(cfg.platformSharePct, 20);

  const fromAdmin = requireDeliverySharePctPair({
    delivery_driver_pct: 0.75,
    delivery_platform_pct: 0.25,
    configKey: "food_default",
  });
  assert.equal(fromAdmin.driverSharePct, 75);
  assert.equal(fromAdmin.platformSharePct, 25);
});

test("nullish engine config (no Admin shares) falls back to defaults 80/20", () => {
  const cfg = normalizeDeliveryPricingConfig({});
  assert.equal(cfg.driverSharePct, 80);
  assert.equal(cfg.platformSharePct, 20);
});

test("requireDeliverySharePctPair accepts complete Admin 70/30", () => {
  const pair = requireDeliverySharePctPair({
    delivery_driver_pct: 70,
    delivery_platform_pct: 30,
    configKey: "food_default",
  });
  assert.deepEqual(pair, { driverSharePct: 70, platformSharePct: 30 });
});

test("restaurant/vendor percentages are not part of delivery share math", () => {
  const cfg = normalizeDeliveryPricingConfig({
    driverSharePct: 80,
    platformSharePct: 20,
  });
  assert.equal(cfg.driverSharePct + cfg.platformSharePct, 100);
});

test("abnormally high delivery fee on short trip is flagged", () => {
  const result = evaluateDeliveryFeeAbnormality(
    45,
    { distanceMiles: 0.5, durationMinutes: 5 },
    { baseFare: 2.5, perMile: 0.9, perMinute: 0.15, minFare: 0, driverSharePct: 80, platformSharePct: 20 }
  );
  assert.equal(result.abnormal, true);
  assert.equal(result.reason, "fee_mismatch_vs_engine");

  expectThrows(
    () =>
      assertDeliveryFeeNotAbnormal(
        45,
        { distanceMiles: 0.5, durationMinutes: 5 },
        { baseFare: 2.5, perMile: 0.9, perMinute: 0.15, minFare: 0, driverSharePct: 80, platformSharePct: 20 }
      ),
    "delivery_fee_abnormal"
  );
});

test("25.44 USD delivery fee matches miles/minutes formula (not cart subtotal)", () => {
  const explained = explainDeliveryFee(
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
  assert.ok(Math.abs(explained.deliveryFee - 25.44) < 0.02);
  assert.match(explained.note, /independent of food subtotal/i);
});

test("quote / Stripe / order total cents consistency", () => {
  assertQuoteMatchesStripeAmount({
    quoteTotal: 33.78,
    stripeAmountCents: 3378,
    orderTotalCents: 3378,
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
});

test("Mapbox meters→miles conversion has no km/miles confusion", () => {
  assert.equal(METERS_PER_MILE, 1609.34);
  assert.equal(metersToMiles(32186.8), 20);
  assert.equal(metersToMiles(1609.34), 1);

  // Feeding meters-as-miles would explode the fee vs a real 20mi trip.
  const wrongFee = computeDeliveryPricing(
    { distanceMiles: 32186.8, durationMinutes: 33 },
    {
      baseFare: 2.5,
      perMile: 0.9,
      perMinute: 0.15,
      minFare: 0,
      driverSharePct: 80,
      platformSharePct: 20,
    }
  ).deliveryFee;
  const rightFee = computeDeliveryPricing(
    { distanceMiles: metersToMiles(32186.8), durationMinutes: 33 },
    {
      baseFare: 2.5,
      perMile: 0.9,
      perMinute: 0.15,
      minFare: 0,
      driverSharePct: 80,
      platformSharePct: 20,
    }
  ).deliveryFee;
  assert.ok(wrongFee > rightFee * 100);
  assert.ok(Math.abs(rightFee - 25.45) < 0.05);
});

console.log("deliveryPricing.test.ts OK");
