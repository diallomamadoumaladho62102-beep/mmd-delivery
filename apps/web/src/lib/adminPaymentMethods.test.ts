import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAdminPaymentMethodView,
  validatePaymentMethodPatch,
} from "./adminPaymentMethods";
import type { PaymentMethodRow } from "./paymentTypes";

function row(partial: Partial<PaymentMethodRow> & Pick<PaymentMethodRow, "country_code" | "provider" | "method_code" | "display_name">): PaymentMethodRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    description: null,
    sort_order: 1,
    enabled: false,
    test_mode: true,
    ...partial,
  };
}

test("admin view exposes runtime availability fields", () => {
  const view = buildAdminPaymentMethodView(
    row({
      country_code: "GN",
      provider: "orange_money_gn",
      method_code: "mobile_money_orange_gn",
      display_name: "Orange Money",
      enabled: true,
    })
  );
  assert.equal(view.runtime_available, false);
  assert.equal(view.secrets_configured, false);
  assert.ok(view.webhook_url?.includes("/api/payments/webhook/orange_money_gn"));
});

test("validatePaymentMethodPatch blocks Stripe enable in Guinea without env flag", () => {
  const existing = row({
    country_code: "GN",
    provider: "stripe",
    method_code: "stripe_card_gn",
    display_name: "Card (Stripe)",
    enabled: false,
  });
  const result = validatePaymentMethodPatch(existing, { enabled: true });
  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.match(result.error, /STRIPE_ENABLED_GN/);
  }
});

test("validatePaymentMethodPatch accepts provider change", () => {
  const existing = row({
    country_code: "CI",
    provider: "cinetpay",
    method_code: "mobile_money_ci",
    display_name: "Mobile Money",
    enabled: true,
  });
  const result = validatePaymentMethodPatch(existing, { provider: "paydunya" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.update.provider, "paydunya");
  }
});
