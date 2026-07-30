/**
 * Unit smoke for food pay-then-create helpers (no DB / Stripe).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  hashFoodCheckoutSnapshot,
  pickFoodQuoteCheckoutId,
  type FoodCheckoutIntentSnapshot,
} from "@/lib/food/foodCheckoutFromQuote";

function baseSnapshot(
  overrides: Partial<FoodCheckoutIntentSnapshot> = {},
): FoodCheckoutIntentSnapshot {
  return {
    version: 1,
    client_user_id: "11111111-1111-1111-1111-111111111111",
    restaurant_user_id: "22222222-2222-2222-2222-222222222222",
    restaurant_name: "Test Resto",
    pickup_address: "A",
    pickup_lat: 25.76,
    pickup_lng: -80.19,
    dropoff_address: "B",
    dropoff_lat: 25.78,
    dropoff_lng: -80.2,
    items: [{ item_id: "item-1", quantity: 1 }],
    country_code: "US",
    currency: "USD",
    amount_cents: 1404,
    ...overrides,
  };
}

test("pickFoodQuoteCheckoutId reads food metadata", () => {
  assert.equal(
    pickFoodQuoteCheckoutId({
      module: "food",
      food_checkout_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    }),
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  );
  assert.equal(pickFoodQuoteCheckoutId({ module: "food", order_id: "x" }), null);
  assert.equal(pickFoodQuoteCheckoutId(null), null);
});

test("hashFoodCheckoutSnapshot is stable and sensitive", () => {
  const h1 = hashFoodCheckoutSnapshot(baseSnapshot());
  const h2 = hashFoodCheckoutSnapshot(baseSnapshot());
  const h3 = hashFoodCheckoutSnapshot(baseSnapshot({ amount_cents: 1405 }));
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  assert.match(h1, /^[a-f0-9]{64}$/);
});
