/**
 * Regression: every finance timeline entity type must go through ownership.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const route = fs.readFileSync(
  path.join(webRoot, "app/api/finance/timeline/route.ts"),
  "utf8"
);
assert.match(route, /resolveFinancialTimelineAccess/);
assert.match(route, /redactFinancialEventReferences/);
assert.doesNotMatch(
  route,
  /entityType === "order"[\s\S]{0,80}buildEntityFinancialTimeline/
);

const access = fs.readFileSync(
  path.join(webRoot, "src/lib/finance/financialTimelineAccess.ts"),
  "utf8"
);
for (const entity of [
  "order",
  "delivery_request",
  "wallet",
  "taxi_ride",
  "seller_order",
  "business_account",
]) {
  assert.match(access, new RegExp(`entityType === "${entity}"`));
}
assert.match(access, /resolveOrderTimelineRole/);
assert.match(access, /resolveWalletTimelineAccess/);
assert.match(access, /client_user_id, user_id, restaurant_user_id, driver_id/);

const builder = fs.readFileSync(
  path.join(webRoot, "src/lib/finance/buildEntityFinancialTimeline.ts"),
  "utf8"
);
assert.match(builder, /redactFinancialEventReferences/);

console.log("financeTimelineIdor.regression.test.ts OK");
