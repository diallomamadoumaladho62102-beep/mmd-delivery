import assert from "node:assert/strict";
import {
  didTaxiConfirmSucceed,
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

console.log("taxiPaymentAbandonFlow tests passed");
