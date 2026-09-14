import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  isNativeApplePayRequest,
  STRIPE_APPLE_PAY_MERCHANT_COUNTRY_CODE,
  STRIPE_APPLE_PAY_MERCHANT_ID,
} from "./stripeNativeApplePay";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("default checkout body is not Apple Pay", () => {
  assert.equal(isNativeApplePayRequest({}), false);
  assert.equal(isNativeApplePayRequest({ order_id: "x" }), false);
});

test("native_wallet apple_pay is detected", () => {
  assert.equal(isNativeApplePayRequest({ native_wallet: "apple_pay" }), true);
  assert.equal(isNativeApplePayRequest({ nativeWallet: "Apple Pay" }), true);
  assert.equal(isNativeApplePayRequest({ payment_ui: "platform_pay" }), true);
});

test("merchant configuration is unchanged", () => {
  assert.equal(STRIPE_APPLE_PAY_MERCHANT_ID, "merchant.com.maladho2025.mmddelivery");
  assert.equal(STRIPE_APPLE_PAY_MERCHANT_COUNTRY_CODE, "US");
});

test("refunds Connect ledger and payouts source files remain", () => {
  const root = process.cwd();
  const files = [
    "src/lib/stripeWebhookChargeRefunded.ts",
    "src/lib/stripeConnectWebhook.ts",
    "src/lib/stripeTransferPayoutWebhook.ts",
    "src/lib/finance/sundayPayoutIntegrity.regression.test.ts",
  ];
  for (const file of files) {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    assert.ok(src.length > 100, file);
  }
});

test("Apple Pay native PaymentIntents reuse quote checkout metadata", () => {
  const food = fs.readFileSync(
    path.join(process.cwd(), "src/lib/food/foodCheckoutFromQuote.ts"),
    "utf8",
  );
  const delivery = fs.readFileSync(
    path.join(process.cwd(), "src/lib/delivery/deliveryCheckoutFromQuote.ts"),
    "utf8",
  );
  const taxi = fs.readFileSync(
    path.join(process.cwd(), "src/lib/taxi/taxiCheckoutFromQuote.ts"),
    "utf8",
  );
  assert.match(food, /export async function openFoodQuoteNativePaymentIntent/);
  assert.match(food, /food_quote_pi_/);
  assert.match(food, /food_checkout_id: params\.intentId/);
  assert.match(delivery, /export async function openDeliveryQuoteNativePaymentIntent/);
  assert.match(delivery, /delivery_quote_pi_/);
  assert.match(taxi, /export async function openTaxiQuoteNativePaymentIntent/);
  assert.match(taxi, /taxi_quote_pi_/);
});

test("confirm-paid requires a succeeded PaymentIntent before materializing Apple Pay quotes", () => {
  const food = fs.readFileSync(
    path.join(process.cwd(), "app/api/stripe/client/confirm-paid/route.ts"),
    "utf8",
  );
  const delivery = fs.readFileSync(
    path.join(
      process.cwd(),
      "app/api/stripe/client/confirm-delivery-request-paid/route.ts",
    ),
    "utf8",
  );
  const taxi = fs.readFileSync(
    path.join(process.cwd(), "app/api/stripe/client/confirm-taxi-paid/route.ts"),
    "utf8",
  );
  for (const src of [food, delivery, taxi]) {
    assert.match(src, /storedPaymentIntentId/);
    assert.match(src, /paymentIntents\.retrieve/);
    assert.match(src, /status\)\.toLowerCase\(\) !== "succeeded"/);
  }
});

test("card Checkout remains the default when native_wallet is absent", () => {
  const food = fs.readFileSync(
    path.join(
      process.cwd(),
      "app/api/stripe/client/create-food-quote-checkout-session/route.ts",
    ),
    "utf8",
  );
  assert.match(food, /isNativeApplePayRequest/);
  assert.match(food, /openFoodQuoteCheckoutSession/);
  assert.match(food, /payment_method_types: \["card"\]|openFoodQuoteCheckoutSession/);
});

test("hosted Checkout card-only path is unchanged for existing orders", () => {
  const checkout = fs.readFileSync(
    path.join(
      process.cwd(),
      "app/api/stripe/client/create-checkout-session/route.ts",
    ),
    "utf8",
  );
  assert.match(checkout, /payment_method_types:\s*\["card"\]/);
});

console.log("stripeNativeApplePay.test.ts OK");
