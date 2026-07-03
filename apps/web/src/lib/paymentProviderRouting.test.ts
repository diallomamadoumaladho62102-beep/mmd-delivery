import assert from "node:assert/strict";
import test from "node:test";
import {
  assertStripeCheckoutAllowed,
  enrichPaymentMethodForClient,
  isStripeBlockedForCountry,
  usesLocalMobileMoney,
} from "./paymentProviderRouting";
import type { PaymentMethodRow } from "./paymentTypes";

function row(partial: Partial<PaymentMethodRow> & Pick<PaymentMethodRow, "country_code" | "provider" | "method_code" | "display_name">): PaymentMethodRow {
  return {
    id: "test",
    description: null,
    sort_order: 1,
    enabled: true,
    test_mode: true,
    ...partial,
  };
}

test("Guinea blocks Stripe by default", () => {
  assert.equal(isStripeBlockedForCountry("GN", true), true);
  assert.equal(assertStripeCheckoutAllowed("GN").ok, false);
});

test("Guinea allows local mobile money routing", () => {
  assert.equal(usesLocalMobileMoney("GN"), true);
  const method = enrichPaymentMethodForClient(
    row({
      country_code: "GN",
      provider: "orange_money_gn",
      method_code: "mobile_money_orange_gn",
      display_name: "Orange Money",
      enabled: true,
    })
  );
  assert.equal(method.client.available, false);
  assert.equal(method.client.unavailable_reason, "Payment method temporarily unavailable");
});

test("Senegal and Côte d'Ivoire prefer local mobile money", () => {
  assert.equal(usesLocalMobileMoney("SN"), true);
  assert.equal(usesLocalMobileMoney("CI"), true);
  assert.equal(usesLocalMobileMoney("US"), false);
});

test("US Stripe checkout remains allowed", () => {
  assert.equal(assertStripeCheckoutAllowed("US").ok, true);
  assert.equal(isStripeBlockedForCountry("US", true), false);
});
