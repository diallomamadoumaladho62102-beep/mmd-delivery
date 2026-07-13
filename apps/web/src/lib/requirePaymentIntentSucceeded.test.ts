import assert from "node:assert/strict";
import { evaluateStripeSettlement } from "./requirePaymentIntentSucceeded";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

// A succeeded PaymentIntent is the canonical "definitively paid" signal.
test("succeeded PaymentIntent settles with amount + currency", () => {
  const r = evaluateStripeSettlement({
    paymentIntent: { id: "pi_1", status: "succeeded", amount: 1299, currency: "USD" },
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.payment_intent_id, "pi_1");
    assert.equal(r.amount_cents, 1299);
    assert.equal(r.currency, "usd");
  }
});

test("non-succeeded PaymentIntent is NOT settled", () => {
  for (const status of [
    "requires_payment_method",
    "requires_action",
    "processing",
    "requires_capture",
    "canceled",
  ]) {
    const r = evaluateStripeSettlement({
      paymentIntent: { id: "pi_x", status, amount: 1000, currency: "usd" },
    });
    assert.equal(r.ok, false, `status ${status} must not settle`);
    if (!r.ok) assert.equal(r.reason, `payment_intent_status_${status}`);
  }
});

test("succeeded PaymentIntent with non-positive amount is rejected", () => {
  const r = evaluateStripeSettlement({
    paymentIntent: { id: "pi_0", status: "succeeded", amount: 0, currency: "usd" },
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "payment_intent_amount_missing");
});

// The core hardening: a PAID session alone is not enough — the PaymentIntent must succeed.
test("session payment_status=paid WITHOUT a succeeded PI is NOT settled", () => {
  const r = evaluateStripeSettlement({
    session: {
      id: "cs_1",
      payment_status: "paid",
      status: "complete",
      amount_total: 5000,
      currency: "usd",
      payment_intent: "pi_unresolved",
    },
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "checkout_session_pi_unresolved_paid");
    assert.equal(r.payment_intent_id, "pi_unresolved");
  }
});

test("session with expanded succeeded PI settles", () => {
  const r = evaluateStripeSettlement({
    session: {
      id: "cs_2",
      payment_status: "paid",
      status: "complete",
      amount_total: 5000,
      currency: "usd",
      payment_intent: { id: "pi_2", status: "succeeded", amount: 5000, currency: "usd" },
    },
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.payment_intent_id, "pi_2");
    assert.equal(r.amount_cents, 5000);
    assert.equal(r.session_id, "cs_2");
  }
});

test("session with expanded non-succeeded PI is NOT settled", () => {
  const r = evaluateStripeSettlement({
    session: {
      id: "cs_3",
      payment_status: "paid",
      status: "complete",
      amount_total: 5000,
      currency: "usd",
      payment_intent: { id: "pi_3", status: "requires_action", amount: 5000, currency: "usd" },
    },
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "payment_intent_status_requires_action");
});

// Genuinely free checkout (no PaymentIntent) is the only PI-less settled case.
test("free no_payment_required session settles with null PI", () => {
  const r = evaluateStripeSettlement({
    session: {
      id: "cs_free",
      payment_status: "no_payment_required",
      status: "complete",
      amount_total: 0,
      currency: "usd",
      payment_intent: null,
    },
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.payment_intent_id, null);
    assert.equal(r.amount_cents, 0);
  }
});

test("no_payment_required with a positive amount is NOT auto-settled", () => {
  const r = evaluateStripeSettlement({
    session: {
      id: "cs_weird",
      payment_status: "no_payment_required",
      status: "complete",
      amount_total: 1000,
      currency: "usd",
      payment_intent: null,
    },
  });
  assert.equal(r.ok, false);
});

test("missing references are not settled", () => {
  const r = evaluateStripeSettlement({});
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "missing_stripe_reference");
});

console.log("requirePaymentIntentSucceeded tests passed");
