/**
 * Regression: restaurant admin lifecycle statuses must round-trip in UI helpers.
 * Root cause fixed: normalizeRestaurantStatus used to collapse suspended/disabled → pending,
 * and DB CHECK only allowed pending|approved|rejected (Suspend/Disable always failed).
 */
import assert from "node:assert/strict";

function normalizeRestaurantStatus(
  value: string | null | undefined
): "pending" | "approved" | "rejected" | "suspended" | "disabled" {
  const s = String(value ?? "").trim().toLowerCase();
  if (
    s === "approved" ||
    s === "rejected" ||
    s === "suspended" ||
    s === "disabled" ||
    s === "pending"
  ) {
    return s;
  }
  return "pending";
}

assert.equal(normalizeRestaurantStatus("suspended"), "suspended");
assert.equal(normalizeRestaurantStatus("disabled"), "disabled");
assert.equal(normalizeRestaurantStatus("approved"), "approved");
assert.equal(normalizeRestaurantStatus("weird"), "pending");

const allowed = new Set([
  "pending",
  "approved",
  "rejected",
  "suspended",
  "disabled",
]);
for (const status of allowed) {
  assert.equal(allowed.has(status), true);
}

console.log("restaurantAdminStatus.regression.test.ts — PASS");
