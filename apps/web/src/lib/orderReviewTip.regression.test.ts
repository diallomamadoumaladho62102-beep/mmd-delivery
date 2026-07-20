/**
 * Regression: post-delivery review/tip must not trip
 * orders_financial_update_forbidden: grand_total.
 *
 * Generated columns (grand_total, total_cents) must never be compared in the
 * BEFORE UPDATE financial guard — PostgreSQL computes them after BEFORE triggers.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(process.cwd(), "..", "..");
const migration = readFileSync(
  join(
    repoRoot,
    "supabase/migrations/20260912120000_fix_order_review_tip_financial_guard.sql",
  ),
  "utf8",
);
const mobileScreen = readFileSync(
  join(
    repoRoot,
    "apps/mobile/src/screens/ClientOrderDetailsScreen.tsx",
  ),
  "utf8",
);

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("financial guard migration stops comparing generated columns", () => {
  assert.match(migration, /guard_orders_client_financial_update/);
  assert.match(migration, /Do NOT compare generated columns/);
  assert.doesNotMatch(
    migration,
    /NEW\.grand_total is distinct from OLD\.grand_total/,
  );
  assert.doesNotMatch(
    migration,
    /NEW\.total_cents is distinct from OLD\.total_cents/,
  );
  assert.match(migration, /items_subtotal/);
  assert.match(migration, /tip_cents is intentionally allowed/);
});

test("official review+tip RPC freezes paid totals", () => {
  assert.match(migration, /submit_order_review_and_tip/);
  assert.match(migration, /order_paid_totals_must_remain_frozen/);
  assert.match(migration, /order_ratings/);
  assert.match(migration, /on conflict \(order_id, rater_id\)/);
});

test("mobile client uses official review+tip RPC", () => {
  assert.match(mobileScreen, /submit_order_review_and_tip/);
  assert.doesNotMatch(
    mobileScreen,
    /\.from\("orders"\)\s*\n\s*\.update\(\{\s*tip_cents/,
  );
});

console.log("orderReviewTip regression tests passed");
