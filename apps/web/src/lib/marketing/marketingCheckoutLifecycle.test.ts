/**
 * Phase 7.1 — marketing lifecycle unit tests (no live DB).
 * Prepared for local/CI shell; not executed when shell is unavailable.
 */
import assert from "node:assert/strict";
import {
  campaignIdsFromReserve,
  marketingIdempotencyKey,
  totalMarketingDiscountCents,
} from "@/lib/marketing/marketingCheckoutLifecycle";
import type { MarketingReserveResult } from "@/lib/marketing/marketingEngine";

function emptyReserve(
  overrides: Partial<MarketingReserveResult> = {}
): MarketingReserveResult {
  return {
    ok: true,
    order_discount_cents: 0,
    delivery_fee_discount_cents: 0,
    cashback_cents: 0,
    points_bonus: 0,
    applied: [],
    rejected: [],
    ...overrides,
  };
}

assert.equal(
  marketingIdempotencyKey("food", "ord-1", "reserve"),
  "marketing:food:ord-1:reserve"
);
assert.equal(
  marketingIdempotencyKey("food", "ord-1", "capture"),
  "marketing:food:ord-1:capture"
);
assert.equal(
  marketingIdempotencyKey("delivery", "dr-1", "reserve"),
  "marketing:delivery:dr-1:reserve"
);
assert.equal(
  marketingIdempotencyKey("taxi", "ride-1", "capture"),
  "marketing:taxi:ride-1:capture"
);
assert.equal(
  marketingIdempotencyKey("marketplace", "so-1", "reverse", "re_123"),
  "marketing:marketplace:so-1:reverse:re_123"
);

// Double-reserve / double-capture keys stay stable (idempotent by design).
const k1 = marketingIdempotencyKey("food", "ord-dup", "reserve");
const k2 = marketingIdempotencyKey("food", "ord-dup", "reserve");
assert.equal(k1, k2);

const reserve = emptyReserve({
  order_discount_cents: 500,
  delivery_fee_discount_cents: 200,
  resolve: {
    ok: true,
    order_discount_cents: 500,
    delivery_fee_discount_cents: 200,
    cashback_cents: 100,
    points_bonus: 0,
    applied: [{ campaign_id: "camp-a" }, { campaign_id: "camp-b" }],
    rejected: [],
  },
});

assert.equal(totalMarketingDiscountCents(reserve), 700);
assert.deepEqual(campaignIdsFromReserve(reserve), ["camp-a", "camp-b"]);

// No-promotion path: zero discount, empty campaigns.
const none = emptyReserve();
assert.equal(totalMarketingDiscountCents(none), 0);
assert.deepEqual(campaignIdsFromReserve(none), []);

console.log("marketingCheckoutLifecycle.test.ts: ok");
