import assert from "node:assert/strict";
import test from "node:test";
import { enrichPayoutMethodForClient } from "./payoutMethodRouting";
import { entityTypeToChargeCategory } from "./payoutTypes";
import type { PayoutMethodRow } from "./payoutTypes";

test("entityTypeToChargeCategory maps known entity types", () => {
  assert.equal(entityTypeToChargeCategory("order"), "food_order");
  assert.equal(entityTypeToChargeCategory("delivery_request"), "delivery");
  assert.equal(entityTypeToChargeCategory("taxi_ride"), "taxi");
  assert.equal(entityTypeToChargeCategory("seller_order"), "marketplace");
});

test("enrichPayoutMethodForClient marks bank transfer available when enabled", () => {
  const enriched = enrichPayoutMethodForClient({
    id: "x",
    country_code: "GN",
    recipient_type: "driver",
    provider: "bank_transfer",
    method_code: "payout_bank_gn_driver",
    display_name: "Bank transfer",
    description: null,
    sort_order: 2,
    enabled: true,
    test_mode: true,
    auto_payout_enabled: false,
    payout_frequency: "weekly",
    minimum_payout_cents: 10000,
    platform_commission_pct: 0,
    created_at: "",
    updated_at: "",
  } satisfies PayoutMethodRow);
  assert.equal(enriched.client.available, true);
});
