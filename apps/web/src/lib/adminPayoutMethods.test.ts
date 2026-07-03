import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAdminPayoutMethodView,
  validatePayoutMethodPatch,
} from "./adminPayoutMethods";
import type { PayoutMethodRow } from "./payoutTypes";

function row(
  partial: Partial<PayoutMethodRow> &
    Pick<PayoutMethodRow, "country_code" | "recipient_type" | "provider" | "method_code" | "display_name">
): PayoutMethodRow {
  return {
    id: "00000000-0000-4000-8000-000000000002",
    description: null,
    sort_order: 1,
    enabled: false,
    test_mode: true,
    auto_payout_enabled: false,
    payout_frequency: "manual",
    minimum_payout_cents: 5000,
    platform_commission_pct: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

test("admin payout view exposes runtime availability fields", () => {
  const view = buildAdminPayoutMethodView(
    row({
      country_code: "GN",
      recipient_type: "driver",
      provider: "orange_money_gn",
      method_code: "payout_orange_money_gn_driver",
      display_name: "Orange Money",
      enabled: true,
    })
  );
  assert.equal(view.runtime_available, false);
  assert.equal(view.secrets_configured, false);
});

test("validatePayoutMethodPatch rejects invalid minimum", () => {
  const existing = row({
    country_code: "SN",
    recipient_type: "restaurant",
    provider: "paydunya",
    method_code: "payout_paydunya_sn_restaurant",
    display_name: "PayDunya",
    enabled: true,
  });
  const result = validatePayoutMethodPatch(existing, { minimum_payout_cents: -1 });
  assert.equal(result.ok, false);
});

test("validatePayoutMethodPatch accepts frequency and auto payout", () => {
  const existing = row({
    country_code: "US",
    recipient_type: "driver",
    provider: "stripe_connect",
    method_code: "payout_stripe_us_driver",
    display_name: "Stripe Connect",
    enabled: true,
  });
  const result = validatePayoutMethodPatch(existing, {
    payout_frequency: "immediate",
    auto_payout_enabled: true,
    platform_commission_pct: 12.5,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.update.payout_frequency, "immediate");
    assert.equal(result.update.auto_payout_enabled, true);
    assert.equal(result.update.platform_commission_pct, 12.5);
  }
});
