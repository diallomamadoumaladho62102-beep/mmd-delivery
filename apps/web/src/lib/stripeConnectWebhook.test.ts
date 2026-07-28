import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveStripeConnectStatus,
  isStripeConnectFullyReady,
} from "./stripeConnectStatus";

describe("stripeConnectWebhook helpers", () => {
  it("seller-ready status matches restaurant parity rule", () => {
    assert.equal(
      isStripeConnectFullyReady({
        stripe_account_id: "acct_seller",
        details_submitted: true,
        charges_enabled: true,
        payouts_enabled: true,
      }),
      true
    );
    assert.equal(
      deriveStripeConnectStatus({
        stripe_account_id: "acct_seller",
        details_submitted: true,
        charges_enabled: true,
        payouts_enabled: false,
      }),
      "verification_in_progress"
    );
  });
});
