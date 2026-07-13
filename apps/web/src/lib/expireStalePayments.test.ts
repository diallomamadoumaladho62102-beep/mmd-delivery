import assert from "node:assert/strict";
import {
  decideStripePiAction,
  isExpiredWithMargin,
  shouldExpireLocally,
  EXPIRE_SAFETY_MARGIN_MS,
} from "./expireStalePayments";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`fail - ${name}`);
    throw error;
  }
}

test("margin requires expires_at older than now - margin", () => {
  const now = Date.parse("2026-07-13T12:00:00.000Z");
  const justExpired = new Date(now - EXPIRE_SAFETY_MARGIN_MS + 60_000).toISOString();
  const safelyExpired = new Date(now - EXPIRE_SAFETY_MARGIN_MS - 60_000).toISOString();
  assert.equal(isExpiredWithMargin(justExpired, now), false);
  assert.equal(isExpiredWithMargin(safelyExpired, now), true);
});

test("never cancel succeeded / in-progress PaymentIntents", () => {
  assert.equal(decideStripePiAction("succeeded"), "skip_succeeded");
  assert.equal(decideStripePiAction("processing"), "skip_in_progress");
  assert.equal(decideStripePiAction("requires_action"), "skip_in_progress");
  assert.equal(decideStripePiAction("requires_confirmation"), "skip_in_progress");
  assert.equal(decideStripePiAction("requires_payment_method"), "cancel");
  assert.equal(decideStripePiAction("canceled"), "already_canceled");
});

test("shouldExpireLocally respects payment_status and entity status", () => {
  const now = Date.parse("2026-07-13T12:00:00.000Z");
  const expired = new Date(now - EXPIRE_SAFETY_MARGIN_MS - 1).toISOString();

  assert.equal(
    shouldExpireLocally(
      {
        id: "o1",
        entityType: "order",
        status: "pending",
        payment_status: "unpaid",
        expires_at: expired,
        stripe_session_id: null,
        stripe_payment_intent_id: "pi_x",
      },
      now
    ),
    true
  );

  assert.equal(
    shouldExpireLocally(
      {
        id: "o2",
        entityType: "order",
        status: "pending",
        payment_status: "paid",
        expires_at: expired,
        stripe_session_id: null,
        stripe_payment_intent_id: "pi_x",
      },
      now
    ),
    false
  );

  assert.equal(
    shouldExpireLocally(
      {
        id: "d1",
        entityType: "delivery_request",
        status: "dispatched",
        payment_status: "unpaid",
        expires_at: expired,
        stripe_session_id: null,
        stripe_payment_intent_id: "pi_x",
      },
      now
    ),
    false
  );
});

console.log("expireStalePayments tests passed");
