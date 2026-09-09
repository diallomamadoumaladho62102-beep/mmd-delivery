import assert from "node:assert/strict";
import {
  formatWalletField,
  isPaidPayoutStatus,
  isProcessingPayoutStatus,
  payoutStatusLabel,
} from "./walletDisplay";

assert.equal(formatWalletField({ nested: true }), "—");
assert.equal(formatWalletField("[object Object]"), "—");
assert.equal(formatWalletField("stripe_connect"), "stripe_connect");
assert.equal(payoutStatusLabel("processing"), "driver.wallet.payouts.status.processing");
assert.equal(payoutStatusLabel("paid"), "driver.wallet.payouts.status.paid");
assert.equal(payoutStatusLabel("failed"), "driver.wallet.payouts.status.failed");
assert.equal(payoutStatusLabel("canceled"), "driver.wallet.payouts.status.canceled");
assert.equal(isProcessingPayoutStatus("in_transit"), true);
assert.equal(isPaidPayoutStatus("paid"), true);
assert.equal(isPaidPayoutStatus("processing"), false);

console.log("walletDisplay.test.ts OK");
