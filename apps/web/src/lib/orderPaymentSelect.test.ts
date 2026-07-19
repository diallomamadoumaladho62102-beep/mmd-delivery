import assert from "node:assert/strict";
import {
  ORDER_CONFIRM_PAID_SELECT,
  ORDER_FINANCE_SNAPSHOT_SELECT,
  ORDER_PAYMENT_CHECK_SELECT,
  ORDER_POST_PAID_SELECT,
  assertOrdersSelectOmitsCountryCode,
} from "./orderPaymentSelect";
import { resolveOrderPlatformCountry } from "./platformCountryResolver";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("payment-check SELECT omits country_code and includes coords for resolver", () => {
  assertOrdersSelectOmitsCountryCode(ORDER_PAYMENT_CHECK_SELECT);
  assert.match(ORDER_PAYMENT_CHECK_SELECT, /pickup_lat/);
  assert.match(ORDER_PAYMENT_CHECK_SELECT, /dropoff_lat/);
  assert.match(ORDER_PAYMENT_CHECK_SELECT, /currency/);
  assert.doesNotMatch(ORDER_PAYMENT_CHECK_SELECT, /\bcountry_code\b/);
});

test("post-paid / confirm / finance SELECTs omit country_code", () => {
  for (const select of [
    ORDER_POST_PAID_SELECT,
    ORDER_CONFIRM_PAID_SELECT,
    ORDER_FINANCE_SNAPSHOT_SELECT,
  ]) {
    assertOrdersSelectOmitsCountryCode(select);
    assert.doesNotMatch(select, /\bcountry_code\b/);
  }
});

test("assertOrdersSelectOmitsCountryCode rejects bad SELECT", () => {
  assert.throws(
    () =>
      assertOrdersSelectOmitsCountryCode(
        "id, payment_status, country_code, currency"
      ),
    /must not include country_code/
  );
});

test("food order settlement can resolve country without orders.country_code", () => {
  // Production-compatible row shape for Fouta / Uniondale Live order.
  const country = resolveOrderPlatformCountry({
    currency: "USD",
    pickup_lat: 40.673897,
    pickup_lng: -73.610676,
    dropoff_lat: 40.6940815,
    dropoff_lng: -73.5905813,
  });
  assert.equal(country, "US");
});

console.log("orderPaymentSelect.test.ts: all passed");
