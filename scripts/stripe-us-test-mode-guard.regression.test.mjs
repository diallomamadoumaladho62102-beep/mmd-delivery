import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

const cert = read("scripts/stripe-us-paymentsheet-cert.mjs");
const taxi = read("scripts/stripe-us-taxi-native-pi-cert.mjs");

test("US PaymentSheet cert refuses non-test secret keys", () => {
  assert.match(cert, /sk_test_/);
  assert.match(cert, /Refusing non-test STRIPE_SECRET_KEY|non-test STRIPE_SECRET_KEY|sk_mode !== "test"/);
  assert.match(cert, /pk_live_/);
});

test("US taxi native PI cert refuses live secret keys", () => {
  assert.match(taxi, /sk_test_/);
  assert.match(taxi, /sk_mode !== "test"|non-test sk/);
  assert.match(taxi, /livemode/);
});

test("US taxi cert uses USD / US merchant metadata path", () => {
  assert.match(taxi, /countryCode: "US"/);
  assert.match(taxi, /payment_ui: "platform_pay"/);
  assert.match(taxi, /create-taxi-quote-checkout-session/);
});

console.log("stripe-us-test-mode-guard regression: all checks passed");
