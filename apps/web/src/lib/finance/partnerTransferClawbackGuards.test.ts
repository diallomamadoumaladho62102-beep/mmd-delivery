import assert from "node:assert/strict";
import {
  isBenignTransferReversalError,
  partnerClawbackIdempotencyKey,
} from "./partnerTransferClawbackGuards";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("idempotency key stable per source+entity+transfer+correlation", () => {
  const a = partnerClawbackIdempotencyKey({
    source: "customer_refund",
    entityType: "food_order",
    entityId: "ord_1",
    transferId: "tr_1",
    correlationId: "re_1",
  });
  const b = partnerClawbackIdempotencyKey({
    source: "customer_refund",
    entityType: "food_order",
    entityId: "ord_1",
    transferId: "tr_1",
    correlationId: "re_1",
  });
  const c = partnerClawbackIdempotencyKey({
    source: "customer_refund",
    entityType: "food_order",
    entityId: "ord_1",
    transferId: "tr_1",
    correlationId: "re_2",
  });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(
    a,
    "partner_rev_customer_refund_food_order_ord_1_tr_1_re_1"
  );
});

test("already-reversed is benign; balance_insufficient is not", () => {
  assert.equal(
    isBenignTransferReversalError({
      code: "transfer_already_reversed",
      message: "Transfer has already been reversed",
    }),
    true
  );
  assert.equal(
    isBenignTransferReversalError(
      new Error("This transfer has already been reversed.")
    ),
    true
  );
  assert.equal(
    isBenignTransferReversalError({
      code: "balance_insufficient",
      message: "Insufficient funds in Stripe account",
    }),
    false
  );
});

console.log("partnerTransferClawbackGuards tests passed");
