import assert from "node:assert/strict";
import test from "node:test";
import {
  isTaxiExpirableStatus,
  taxiPendingPaymentExpiresAt,
  taxiUnpaidExpiresAt,
  TAXI_PENDING_PAYMENT_TTL_MS,
  TAXI_UNPAID_TTL_MS,
} from "./taxiUnpaidExpiry";

test("taxi unpaid TTL is 30 minutes", () => {
  const now = new Date("2026-07-25T12:00:00.000Z");
  const expires = taxiUnpaidExpiresAt(now);
  assert.equal(
    Date.parse(expires) - now.getTime(),
    TAXI_UNPAID_TTL_MS
  );
});

test("pending payment TTL is longer than unpaid create TTL", () => {
  const now = new Date("2026-07-25T12:00:00.000Z");
  assert.ok(TAXI_PENDING_PAYMENT_TTL_MS > TAXI_UNPAID_TTL_MS);
  assert.equal(
    Date.parse(taxiPendingPaymentExpiresAt(now)) - now.getTime(),
    TAXI_PENDING_PAYMENT_TTL_MS
  );
});

test("only pre-dispatch unpaid statuses are expirable", () => {
  assert.equal(isTaxiExpirableStatus("quoted"), true);
  assert.equal(isTaxiExpirableStatus("pending_payment"), true);
  assert.equal(isTaxiExpirableStatus("paid"), false);
  assert.equal(isTaxiExpirableStatus("dispatching"), false);
  assert.equal(isTaxiExpirableStatus("accepted"), false);
});
