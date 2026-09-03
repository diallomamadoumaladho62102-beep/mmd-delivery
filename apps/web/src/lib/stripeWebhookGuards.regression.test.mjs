/**
 * Stripe webhook guard rails (signature + event dedup).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const webhook = readFileSync(
  join(import.meta.dirname, "../../app/api/stripe/webhook/route.ts"),
  "utf8",
);

function test(name, fn) {
  fn();
  console.log(`ok ${name}`);
}

test("webhook verifies Stripe signature via constructEvent", () => {
  assert.match(webhook, /constructEvent/);
  assert.match(webhook, /STRIPE_WEBHOOK_SECRET/);
});

test("webhook persists events for idempotent dedup", () => {
  assert.match(webhook, /stripe_webhook_events/);
  assert.match(webhook, /persistStripeEvent/);
});

test("webhook handles payout and transfer lifecycle", () => {
  assert.match(webhook, /payout\.paid|payout\.failed/);
  assert.match(webhook, /transfer\./);
});

console.log("stripe webhook guards regression passed");
