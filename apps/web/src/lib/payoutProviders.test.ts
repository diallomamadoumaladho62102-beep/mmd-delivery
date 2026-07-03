import assert from "node:assert/strict";
import test from "node:test";
import { describePayoutProviderCapabilities } from "./payoutProviders";

test("mobile money payout providers stay manual until env flag enabled", () => {
  const orange = describePayoutProviderCapabilities("orange_money_gn");
  assert.equal(orange.execution_mode, "manual_only");
  assert.equal(orange.env_enable_flag, "ORANGE_MONEY_GN_PAYOUT_ENABLED");
  assert.equal(orange.auto_execution_allowed, false);

  const paydunya = describePayoutProviderCapabilities("paydunya");
  assert.equal(paydunya.execution_mode, "manual_only");
  assert.equal(paydunya.auto_execution_allowed, false);
});

test("stripe connect remains the only automatic provider when configured", () => {
  const original = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_example";
  try {
    const stripe = describePayoutProviderCapabilities("stripe_connect");
    assert.equal(stripe.execution_mode, "automatic");
    assert.equal(stripe.auto_execution_allowed, true);
  } finally {
    if (original === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = original;
  }
});
