import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTaxiFareComponentsDoc,
  filterApplicableFareLines,
  isApplicableFareLine,
  resolveTaxiFareLinesForDisplay,
  TAXI_FARE_COMPONENT_KEYS,
} from "@/lib/taxi/taxiFareComponents";

test("catalog includes all required enterprise fare keys", () => {
  const required = [
    "base",
    "distance",
    "time",
    "minimum_fare",
    "surge",
    "tolls",
    "parking",
    "wait",
    "booking_fee",
    "airport_fee",
    "regulatory_fee",
    "service_fee",
    "cleaning_fee",
    "promo",
    "coupon",
    "wallet_credit",
    "loyalty",
    "tip",
    "tax",
    "refund",
    "adjustment",
    "total",
  ];
  for (const key of required) {
    assert.ok(
      (TAXI_FARE_COMPONENT_KEYS as readonly string[]).includes(key),
      `missing catalog key ${key}`
    );
  }
});

test("zero and null fare lines are omitted from display", () => {
  assert.equal(isApplicableFareLine({ amount_cents: 0 }), false);
  assert.equal(isApplicableFareLine({ amount_cents: null as any }), false);
  assert.equal(isApplicableFareLine({ amount_cents: 100 }), true);

  const doc = buildTaxiFareComponentsDoc({
    currency: "USD",
    distanceMiles: 2,
    durationMinutes: 10,
    pricing: {
      base_fare: 2.5,
      per_mile: 1.5,
      per_minute: 0.4,
      min_fare: 0,
      booking_fee: 1,
      class_multiplier: 1,
      surge_multiplier: 1,
      airport_fee: 0,
      cleaning_fee: 0,
    },
    ride: {
      tax_cents: 150,
      service_fee_cents: 50,
      tolls_cents: null,
      parking_cents: 0,
      surge_cents: null,
      tip_cents: 0,
    },
  });

  const keys = doc.lines.map((l) => l.key);
  assert.ok(keys.includes("base"));
  assert.ok(keys.includes("distance"));
  assert.ok(keys.includes("time"));
  assert.ok(keys.includes("booking_fee"));
  assert.ok(keys.includes("tax"));
  assert.ok(keys.includes("service_fee"));
  assert.equal(keys.includes("surge"), false);
  assert.equal(keys.includes("tolls"), false);
  assert.equal(keys.includes("parking"), false);
  assert.equal(keys.includes("tip"), false);
  assert.ok(doc.rates_snapshot);
});

test("stored fare_components preferred and live tip overlays", () => {
  const lines = resolveTaxiFareLinesForDisplay({
    ride: {
      currency: "USD",
      tip_cents: 300,
      fare_components: {
        version: 1,
        currency: "USD",
        lines: [
          {
            key: "base",
            label_key: "taxi.receipt.fare.base",
            amount_cents: 250,
            kind: "charge",
          },
        ],
      },
    },
    pricing: null,
  });

  assert.deepEqual(
    filterApplicableFareLines(lines).map((l) => l.key).sort(),
    ["base", "tip"]
  );
});

test("legacy rides without fare_components still reconstruct", () => {
  const lines = resolveTaxiFareLinesForDisplay({
    ride: {
      currency: "USD",
      distance_miles: 1,
      duration_minutes: 5,
      tax_cents: 100,
      tip_cents: 200,
    },
    pricing: {
      base_fare: 3,
      per_mile: 1,
      per_minute: 0.5,
      min_fare: 0,
      booking_fee: 0,
      class_multiplier: 1,
      surge_multiplier: 1,
      airport_fee: 0,
      cleaning_fee: 0,
    },
  });
  const keys = lines.map((l) => l.key);
  assert.ok(keys.includes("base"));
  assert.ok(keys.includes("tip"));
  assert.ok(keys.includes("tax"));
});
