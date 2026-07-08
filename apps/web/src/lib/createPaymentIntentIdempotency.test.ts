import assert from "node:assert/strict";

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

testIdempotencyKeyStableForRetry();
testIdempotencyKeyChangesWhenAmountChanges();

console.log("createPaymentIntentIdempotency.test.ts OK");
