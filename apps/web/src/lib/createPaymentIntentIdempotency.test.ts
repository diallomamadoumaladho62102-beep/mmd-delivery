import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function buildPaymentIntentIdempotencyKey(
  orderId: string,
  amount: number,
  currency: string,
): string {
  return `mmd-order-pi-${orderId}-${amount}-${currency}`.slice(0, 255);
}

function testIdempotencyKeyStableForRetry() {
  const keyA = buildPaymentIntentIdempotencyKey("order-1", 1299, "usd");
  const keyB = buildPaymentIntentIdempotencyKey("order-1", 1299, "usd");
  assert.equal(keyA, keyB);
  assert.equal(keyA, "mmd-order-pi-order-1-1299-usd");
}

function testIdempotencyKeyChangesWhenAmountChanges() {
  const keyA = buildPaymentIntentIdempotencyKey("order-1", 1299, "usd");
  const keyB = buildPaymentIntentIdempotencyKey("order-1", 1399, "usd");
  assert.notEqual(keyA, keyB);
}

function testCreatePaymentIntentDoesNotTrustClientAmount() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const src = fs.readFileSync(
    path.join(root, "supabase/functions/create_payment_intent/index.ts"),
    "utf8",
  );
  assert.match(src, /resolveOrderAmountCents\(order\)/);
  assert.doesNotMatch(src, /body\.amount/);
  assert.doesNotMatch(src, /amount_from_client/);
  assert.match(src, /merchantCountryCode: "US"/);
  assert.match(src, /automatic_payment_methods/);
}

testIdempotencyKeyStableForRetry();
testIdempotencyKeyChangesWhenAmountChanges();
testCreatePaymentIntentDoesNotTrustClientAmount();

console.log("createPaymentIntentIdempotency.test.ts OK");
