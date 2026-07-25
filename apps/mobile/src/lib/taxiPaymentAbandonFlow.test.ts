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
});

test("payment refused / unpaid → stay and await expiry (no immediate cancel)", () => {
  assert.equal(
    nextActionAfterCheckoutReturn({
      confirmResult: { ok: false, error: "not_paid" },
      confirmThrew: false,
    }),
    "stay_on_quote_await_expiry"
  );
});

test("user closes Checkout / confirm throws → stay and await expiry", () => {
  assert.equal(
    nextActionAfterCheckoutReturn({
      confirmResult: null,
      confirmThrew: true,
    }),
    "stay_on_quote_await_expiry"
  );
});

test("timeout / network blip treated as not paid yet (no cancel race)", () => {
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
