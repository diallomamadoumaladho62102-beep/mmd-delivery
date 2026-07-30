/**
 * Unit smoke for package delivery pay-then-create helpers (no DB / Stripe).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  hashDeliveryCheckoutSnapshot,
  pickDeliveryQuoteCheckoutId,
  type DeliveryCheckoutIntentSnapshot,
} from "@/lib/delivery/deliveryCheckoutFromQuote";

function baseSnapshot(
  overrides: Partial<DeliveryCheckoutIntentSnapshot> = {},
): DeliveryCheckoutIntentSnapshot {
  return {
    version: 1,
    client_user_id: "11111111-1111-1111-1111-111111111111",
    request_type: "package",
    title: "Package",
    pickup_address: "A",
    dropoff_address: "B",
    pickup_lat: 25.76,
    pickup_lng: -80.19,
    dropoff_lat: 25.78,
    dropoff_lng: -80.2,
    country_code: "US",
    currency: "USD",
    amount_cents: 570,
    ...overrides,
  };
}

test("pickDeliveryQuoteCheckoutId reads delivery metadata", () => {
  assert.equal(
    pickDeliveryQuoteCheckoutId({
      module: "delivery",
      delivery_checkout_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    }),
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  );
  assert.equal(
    pickDeliveryQuoteCheckoutId({ module: "delivery", delivery_request_id: "x" }),
    null,
  );
  assert.equal(pickDeliveryQuoteCheckoutId(null), null);
});

test("hashDeliveryCheckoutSnapshot is stable and sensitive", () => {
  const h1 = hashDeliveryCheckoutSnapshot(baseSnapshot());
  const h2 = hashDeliveryCheckoutSnapshot(baseSnapshot());
  const h3 = hashDeliveryCheckoutSnapshot(baseSnapshot({ amount_cents: 571 }));
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  assert.match(h1, /^[a-f0-9]{64}$/);
});
