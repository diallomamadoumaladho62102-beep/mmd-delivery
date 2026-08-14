import assert from "node:assert/strict";
import {
  didTaxiConfirmSucceed,
  isExpectedTaxiPaymentPendingResponse,
  isExpectedUnpaidPaymentSentryNoise,
  nextActionAfterCheckoutReturn,
} from "./taxiPaymentAbandonFlow";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`fail - ${name}`);
    throw error;
  }
}

test("payment succeeded → tracking", () => {
  assert.equal(
    nextActionAfterCheckoutReturn({
      confirmResult: { ok: true },
      confirmThrew: false,
    }),
    "go_tracking"
  );
  assert.equal(
    nextActionAfterCheckoutReturn({
      confirmResult: { already_paid: true },
      confirmThrew: false,
    }),
    "go_tracking"
  );
  assert.equal(
    nextActionAfterCheckoutReturn({
      confirmResult: { ok: true, taxi_ride_id: "11111111-1111-1111-1111-111111111111" },
      confirmThrew: false,
    }),
    "go_tracking"
  );
});

test("pay-then-create without ride id stays on quote", () => {
  assert.equal(
    nextActionAfterCheckoutReturn({
      confirmResult: { ok: true, taxi_ride_id: "" },
      confirmThrew: false,
    }),
    "stay_on_quote_await_expiry"
  );
});

test("payment refused / unpaid → stay (no ride created)", () => {
  assert.equal(
    nextActionAfterCheckoutReturn({
      confirmResult: { ok: false, error: "not_paid" },
      confirmThrew: false,
    }),
    "stay_on_quote_await_expiry"
  );
});

test("user closes Checkout / confirm throws → stay (no ride created)", () => {
  assert.equal(
    nextActionAfterCheckoutReturn({
      confirmResult: null,
      confirmThrew: true,
    }),
    "stay_on_quote_await_expiry"
  );
});

test("timeout / network blip treated as not paid yet", () => {
  assert.equal(
    nextActionAfterCheckoutReturn({
      confirmResult: null,
      confirmThrew: false,
    }),
    "stay_on_quote_await_expiry"
  );
});

test("double callback already_paid is idempotent success", () => {
  assert.equal(didTaxiConfirmSucceed({ already_paid: true }), true);
  assert.equal(didTaxiConfirmSucceed({ ok: true, already_paid: true }), true);
});

test("unpaid confirm-taxi-paid 409 is expected business pending", () => {
  assert.equal(
    isExpectedTaxiPaymentPendingResponse(409, {
      ok: false,
      error: "Stripe payment not confirmed yet",
      payment_status: "unpaid",
    }),
    true
  );
  assert.equal(
    isExpectedTaxiPaymentPendingResponse(409, {
      error: "Ride or offer status changed",
    }),
    false
  );
});

test("unpaid 409 must not be treated as Sentry Error noise filter pass", () => {
  const unpaidBody = {
    ok: false,
    error: "Stripe payment not confirmed yet",
    payment_status: "unpaid",
  };
  assert.equal(isExpectedUnpaidPaymentSentryNoise(unpaidBody, { status: 409 }), true);
  assert.equal(
    isExpectedUnpaidPaymentSentryNoise(new Error("Stripe payment not confirmed yet")),
    true
  );
  assert.equal(
    isExpectedUnpaidPaymentSentryNoise(
      new Error(
        "Payment was not completed. Please check your payment method and try again.",
      ),
    ),
    true
  );
});

test("real Stripe/server failures must still be Sentry-eligible", () => {
  assert.equal(
    isExpectedUnpaidPaymentSentryNoise(
      { error: "Stripe API error: No such payment_intent" },
      { status: 500 },
    ),
    false
  );
  assert.equal(
    isExpectedUnpaidPaymentSentryNoise(
      { error: "Unauthorized" },
      { status: 401 },
    ),
    false
  );
  assert.equal(
    isExpectedUnpaidPaymentSentryNoise(
      { error: "Ride or offer status changed" },
      { status: 409 },
    ),
    false
  );
  assert.equal(
    isExpectedUnpaidPaymentSentryNoise(new Error("card_declined"), { status: 402 }),
    false
  );
});

console.log("taxiPaymentAbandonFlow tests passed");
