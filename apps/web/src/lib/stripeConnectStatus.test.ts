import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveStripeConnectStatus,
  isStripeConnectFullyReady,
  stripeConnectStatusLabel,
} from "./stripeConnectStatus";

describe("stripeConnectStatus", () => {
  it("requires account id for setup_required", () => {
    assert.equal(deriveStripeConnectStatus({}), "setup_required");
    assert.equal(
      deriveStripeConnectStatus({ stripe_account_id: null }),
      "setup_required",
    );
  });

  it("uses strict readiness for ready_for_payouts", () => {
    assert.equal(
      isStripeConnectFullyReady({
        stripe_account_id: "acct_1",
        details_submitted: true,
        charges_enabled: true,
        payouts_enabled: true,
      }),
      true,
    );
    assert.equal(
      deriveStripeConnectStatus({
        stripe_account_id: "acct_1",
        details_submitted: true,
        charges_enabled: true,
        payouts_enabled: false,
      }),
      "verification_in_progress",
    );
    assert.equal(
      deriveStripeConnectStatus({
        stripe_account_id: "acct_1",
        details_submitted: true,
        charges_enabled: true,
        payouts_enabled: true,
      }),
      "ready_for_payouts",
    );
  });

  it("maps restricted and disabled reasons", () => {
    assert.equal(
      deriveStripeConnectStatus({
        stripe_account_id: "acct_1",
        disabled_reason: "rejected.fraud",
      }),
      "restricted",
    );
    assert.equal(
      deriveStripeConnectStatus({
        stripe_account_id: "acct_1",
        disabled_reason: "requirements.past_due",
      }),
      "disabled",
    );
    assert.equal(
      deriveStripeConnectStatus({
        stripe_account_id: "acct_1",
        details_submitted: false,
        past_due_count: 2,
      }),
      "restricted",
    );
  });

  it("exposes clear labels", () => {
    assert.equal(stripeConnectStatusLabel("setup_required"), "Setup required");
    assert.equal(
      stripeConnectStatusLabel("ready_for_payouts"),
      "Ready for payouts",
    );
  });
});
