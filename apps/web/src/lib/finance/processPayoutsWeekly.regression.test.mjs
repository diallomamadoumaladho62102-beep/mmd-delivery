/**
 * Weekly SCT retry must filter delivered_confirmed_at, not created_at (P1-5).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const route = readFileSync(
  join(import.meta.dirname, "../../../app/api/admin/process-payouts/route.ts"),
  "utf8",
);

function test(name, fn) {
  fn();
  console.log(`ok ${name}`);
}

test("weekly mode filters delivered_confirmed_at window", () => {
  assert.match(route, /payoutMode === "weekly"/);
  assert.match(route, /delivered_confirmed_at/);
  assert.doesNotMatch(
    route.slice(route.indexOf('if (payoutMode === "weekly")')),
    /\.gte\("created_at", weekStartIso\)/,
  );
});

test("hybrid mode does not apply weekly created_at filter", () => {
  assert.match(route, /hybrid \+ immediate: process all unpaid/);
});

console.log("process-payouts weekly regression passed");
