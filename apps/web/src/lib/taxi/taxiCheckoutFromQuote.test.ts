/**
 * Unit smoke for taxi pay-then-create helpers (no DB / Stripe).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  hashTaxiCheckoutSnapshot,
  pickTaxiQuoteCheckoutId,
  type TaxiCheckoutIntentSnapshot,
} from "@/lib/taxi/taxiCheckoutFromQuote";

function baseSnapshot(
  overrides: Partial<TaxiCheckoutIntentSnapshot> = {},
): TaxiCheckoutIntentSnapshot {
  return {
    version: 1,
    client_user_id: "11111111-1111-1111-1111-111111111111",
    country_code: "US",
    currency: "USD",
    amount_cents: 639,
    vehicle_class: "standard",
    passenger_count: 1,
    pickup_address: "A",
    dropoff_address: "B",
    pickup_lat: 25.76,
    pickup_lng: -80.19,
    dropoff_lat: 25.78,
    dropoff_lng: -80.2,
    distance_miles: 2.1,
    duration_minutes: 12,
    subtotal_cents: 500,
    tax_cents: 39,
    platform_fee_cents: 100,
    driver_payout_cents: 400,
    service_fee_cents: 0,
    service_fee_pct: 0,
    service_fee_enabled: false,
    service_fee_fixed_cents: 0,
    gross_total_cents: 639,
    mmd_plus_discount_cents: 0,
    ...overrides,
  };
}

test("pickTaxiQuoteCheckoutId reads quote metadata", () => {
  assert.equal(
    pickTaxiQuoteCheckoutId({
      module: "taxi",
      quote_checkout_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    }),
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  );
  assert.equal(pickTaxiQuoteCheckoutId({ module: "taxi", taxi_ride_id: "x" }), null);
  assert.equal(pickTaxiQuoteCheckoutId(null), null);
});

test("hashTaxiCheckoutSnapshot is stable and sensitive", () => {
  const h1 = hashTaxiCheckoutSnapshot(baseSnapshot());
  const h2 = hashTaxiCheckoutSnapshot(baseSnapshot());
  const h3 = hashTaxiCheckoutSnapshot(baseSnapshot({ amount_cents: 640 }));
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  assert.match(h1, /^[a-f0-9]{64}$/);
});
