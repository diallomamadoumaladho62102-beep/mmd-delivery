import assert from "node:assert/strict";
import {
  buildApplePayCartItems,
  formatApplePayCartAmount,
  isPaidLikeConfirmResult,
  mapApplePayConfirmOutcome,
  parseServerPaymentIntentPayload,
  shouldShowApplePayButton,
  STRIPE_APPLE_PAY_MERCHANT_ID,
} from "./applePayCheckout";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("card remains available when Apple Pay is unsupported", () => {
  assert.equal(
    shouldShowApplePayButton({ platform: "ios", isPlatformPaySupported: false }),
    false,
  );
});

test("Apple Pay button shows only on iOS when platform pay is supported", () => {
  assert.equal(
    shouldShowApplePayButton({ platform: "ios", isPlatformPaySupported: true }),
    true,
  );
  assert.equal(
    shouldShowApplePayButton({ platform: "android", isPlatformPaySupported: true }),
    false,
  );
});

test("Apple Pay cancel does not mark paid", () => {
  assert.equal(
    mapApplePayConfirmOutcome({ errorCode: "Canceled" }),
    "canceled",
  );
  assert.equal(isPaidLikeConfirmResult({ ok: false }), false);
});

test("Apple Pay failure does not mark paid", () => {
  assert.equal(
    mapApplePayConfirmOutcome({ errorCode: "Failed", errorMessage: "declined" }),
    "failed",
  );
  assert.equal(isPaidLikeConfirmResult(null), false);
});

test("Apple Pay success requires PaymentIntent succeeded", () => {
  assert.equal(
    mapApplePayConfirmOutcome({ paymentIntentStatus: "Succeeded" }),
    "succeeded",
  );
  assert.equal(
    mapApplePayConfirmOutcome({ paymentIntentStatus: "RequiresPaymentMethod" }),
    "failed",
  );
  assert.equal(isPaidLikeConfirmResult({ ok: true, payment_status: "paid" }), true);
});

test("opening the sheet is not treated as paid", () => {
  assert.equal(mapApplePayConfirmOutcome({}), "failed");
});

test("server payload ignores client amount fields for charging", () => {
  const parsed = parseServerPaymentIntentPayload({
    clientSecret: "pi_123_secret",
    paymentIntentId: "pi_123",
    amount: 1500,
    currency: "usd",
    merchantCountryCode: "US",
    client_amount: 1,
    amount_from_client: 999999,
  });
  assert.equal(parsed.stripeAmount, 1500);
  assert.equal(parsed.currencyCode, "usd");
  assert.equal(parsed.clientSecret, "pi_123_secret");
});

test("already-paid payload is idempotent", () => {
  const parsed = parseServerPaymentIntentPayload({ alreadyPaid: true });
  assert.equal(parsed.alreadyPaid, true);
  assert.equal(parsed.clientSecret, null);
});

test("Apple Pay cart amount uses server Stripe amount", () => {
  assert.equal(formatApplePayCartAmount("usd", 1299), "12.99");
  assert.equal(formatApplePayCartAmount("GNF", 5000), "5000");
  const items = buildApplePayCartItems({
    currency: "usd",
    stripeAmount: 1404,
  });
  assert.equal(items[0]?.amount, "14.04");
  assert.equal(items[0]?.paymentType, "Immediate");
});

test("merchant id is the existing Apple Pay merchant", () => {
  assert.equal(STRIPE_APPLE_PAY_MERCHANT_ID, "merchant.com.maladho2025.mmddelivery");
});

test("retry already-paid confirm is idempotent and not a second charge", () => {
  assert.equal(
    isPaidLikeConfirmResult({ ok: true, already: true, already_paid: true }),
    true,
  );
});

console.log("applePayCheckout.test.ts OK");
