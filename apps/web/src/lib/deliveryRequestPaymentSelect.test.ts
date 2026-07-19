import assert from "node:assert/strict";
import {
  DELIVERY_REQUEST_CONFIRM_PAID_SELECT,
  DELIVERY_REQUEST_FINANCE_SNAPSHOT_SELECT,
  DELIVERY_REQUEST_PAYMENT_CHECK_SELECT,
  assertDeliveryRequestSelectOmitsCountryCode,
} from "./deliveryRequestPaymentSelect";
import { resolveDeliveryRequestPlatformCountry } from "./platformCountryResolver";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("payment-check SELECT omits country_code and includes coords", () => {
  assertDeliveryRequestSelectOmitsCountryCode(
    DELIVERY_REQUEST_PAYMENT_CHECK_SELECT,
  );
  assert.match(DELIVERY_REQUEST_PAYMENT_CHECK_SELECT, /pickup_lat/);
  assert.match(DELIVERY_REQUEST_PAYMENT_CHECK_SELECT, /currency/);
  assert.doesNotMatch(DELIVERY_REQUEST_PAYMENT_CHECK_SELECT, /\bcountry_code\b/);
});

test("confirm-paid SELECT omits country_code", () => {
  assertDeliveryRequestSelectOmitsCountryCode(
    DELIVERY_REQUEST_CONFIRM_PAID_SELECT,
  );
  assert.doesNotMatch(DELIVERY_REQUEST_CONFIRM_PAID_SELECT, /\bcountry_code\b/);
});

test("assertDeliveryRequestSelectOmitsCountryCode rejects bad SELECT", () => {
  assert.throws(
    () =>
      assertDeliveryRequestSelectOmitsCountryCode(
        "id, payment_status, country_code, currency",
      ),
    /must not include country_code/,
  );
});

test("delivery request country resolves without country_code column", () => {
  const country = resolveDeliveryRequestPlatformCountry({
    currency: "USD",
    pickup_lat: 40.673897,
    pickup_lng: -73.610676,
  });
  assert.equal(country, "US");
});

test("finance snapshot SELECT omits country_code", () => {
  assertDeliveryRequestSelectOmitsCountryCode(
    DELIVERY_REQUEST_FINANCE_SNAPSHOT_SELECT,
  );
  assert.match(DELIVERY_REQUEST_FINANCE_SNAPSHOT_SELECT, /pickup_lat/);
});

console.log("deliveryRequestPaymentSelect.test.ts: all passed");
