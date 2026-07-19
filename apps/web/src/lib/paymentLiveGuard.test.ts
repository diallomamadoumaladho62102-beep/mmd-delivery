import assert from "node:assert/strict";
import {
  detectStripeKeyMode,
  isAppProductionEnv,
  assertStripeModeAllowed,
} from "./paymentLiveGuard";

assert.equal(detectStripeKeyMode("sk_test_abc"), "test");
assert.equal(detectStripeKeyMode("sk_live_abc"), "live");

const prevVercel = process.env.VERCEL_ENV;
const prevKey = process.env.STRIPE_SECRET_KEY;
try {
  process.env.VERCEL_ENV = "preview";
  process.env.STRIPE_SECRET_KEY = "sk_live_should_block";
  const blocked = assertStripeModeAllowed("unit-test");
  assert.equal(blocked.ok, false);

  process.env.STRIPE_SECRET_KEY = "sk_test_ok";
  const allowed = assertStripeModeAllowed("unit-test");
  assert.equal(allowed.ok, true);
  assert.equal(isAppProductionEnv(), false);
} finally {
  if (prevVercel === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = prevVercel;
  if (prevKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = prevKey;
}

console.log("paymentLiveGuard.test.ts: ok");
