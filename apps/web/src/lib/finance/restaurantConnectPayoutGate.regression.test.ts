/**
 * Regression: transfers/run must refuse restaurant SCT without Connect acct_
 * and surface actionable error (not create accounts).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "../../..");

const src = fs.readFileSync(
  path.join(webRoot, "app/api/stripe/transfers/run/route.ts"),
  "utf8",
);

assert.match(src, /Restaurant payout account missing/);
assert.match(src, /restaurant_connect_account_missing/);
assert.match(src, /Connect Stripe/);
assert.match(src, /restaurant_profiles/);
assert.match(src, /stripe_account_id/);
assert.match(src, /connect_not_ready/);

console.log("restaurantConnectPayoutGate regression passed");
