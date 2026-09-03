/**
 * Marketplace checkout Stripe idempotency (B7 fix).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const src = readFileSync(
  join(import.meta.dirname, "marketplaceLiveCheckoutService.ts"),
  "utf8",
);

function test(name, fn) {
  fn();
  console.log(`ok ${name}`);
}

test("marketplace checkout uses stable Stripe idempotency key", () => {
  assert.match(src, /checkoutIdempotencyKey\s*=\s*`mkt_checkout_\$\{order\.id\}_/);
  assert.match(src, /idempotencyKey:\s*checkoutIdempotencyKey/);
});

console.log("marketplaceLiveCheckout idempotency regression passed");
