import assert from "node:assert/strict";
import {
  restaurantStripeConnectCta,
  isStripeConnectReady,
  deriveRestaurantConnectStatus,
} from "./stripeConnectStatus";

assert.equal(isStripeConnectReady("setup_required"), false);
assert.equal(isStripeConnectReady("ready_for_payouts"), true);

assert.equal(
  deriveRestaurantConnectStatus({
    stripe_account_id: null,
    stripe_onboarding_status: "ready_for_payouts",
    stripe_charges_enabled: true,
    stripe_payouts_enabled: true,
    stripe_details_submitted: true,
  }),
  "setup_required",
);
assert.equal(
  deriveRestaurantConnectStatus({
    stripe_account_id: "acct_123",
    stripe_onboarding_status: "ready_for_payouts",
    stripe_charges_enabled: true,
    stripe_payouts_enabled: true,
    stripe_details_submitted: true,
  }),
  "ready_for_payouts",
);

const setup = restaurantStripeConnectCta("setup_required");
assert.match(setup.action, /Connect Stripe/i);
assert.match(setup.body, /bank/i);
assert.doesNotMatch(setup.body, /Paid|Stripe Ready/i);

assert.match(restaurantStripeConnectCta("verification_pending").action, /Complete/i);
assert.match(restaurantStripeConnectCta("verification_in_progress").action, /Continue/i);
assert.match(restaurantStripeConnectCta("ready_for_payouts").action, /Manage Payouts/i);
assert.match(restaurantStripeConnectCta("restricted").action, /Fix Stripe/i);

console.log("stripeConnectStatus.test.ts OK");
