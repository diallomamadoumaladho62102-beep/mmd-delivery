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
assert.equal(payoutStatusLabel("processing"), "Processing");
assert.equal(payoutStatusLabel("paid"), "Paid");
assert.equal(payoutStatusLabel("failed"), "Failed");
assert.equal(payoutStatusLabel("canceled"), "Canceled");
assert.equal(isProcessingPayoutStatus("in_transit"), true);
assert.equal(isPaidPayoutStatus("paid"), true);
assert.equal(isPaidPayoutStatus("processing"), false);

console.log("walletDisplay.test.ts OK");
