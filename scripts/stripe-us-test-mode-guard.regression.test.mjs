import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const LEGACY_SUPABASE_ENV_NAMES = [
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

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

const certRel = "scripts/stripe-us-paymentsheet-cert.mjs";
const taxiRel = "scripts/stripe-us-taxi-native-pi-cert.mjs";
const cert = read(certRel);
const taxi = read(taxiRel);

test("US PaymentSheet cert refuses non-test secret keys", () => {
  assert.match(cert, /sk_test_/);
  assert.match(
    cert,
    /Refusing non-test STRIPE_SECRET_KEY|non-test STRIPE_SECRET_KEY|sk_mode !== "test"/,
  );
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

test("US Stripe cert scripts never read legacy Supabase env aliases", () => {
  for (const [rel, src] of [
    [certRel, cert],
    [taxiRel, taxi],
  ]) {
    for (const name of LEGACY_SUPABASE_ENV_NAMES) {
      assert.equal(
        src.includes(name),
        false,
        `${rel} must not contain legacy env name ${name}`,
      );
    }
  }
});

test("US PaymentSheet cert uses publishable + secret official key names", () => {
  assert.match(cert, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(cert, /SUPABASE_SECRET_KEY/);
  assert.match(cert, /publishableKey/);
  assert.doesNotMatch(cert, /\banon\b/);
});

console.log("stripe-us-test-mode-guard regression: all checks passed");
