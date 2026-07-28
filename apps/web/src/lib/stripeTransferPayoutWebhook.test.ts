import assert from "node:assert/strict";
import { resolveStripePayoutNextStatus } from "./stripeTransferPayoutWebhook";

assert.equal(resolveStripePayoutNextStatus("payout.created", "pending"), "processing");
assert.equal(resolveStripePayoutNextStatus("payout.created", "in_transit"), "processing");
assert.equal(resolveStripePayoutNextStatus("payout.updated", "in_transit"), "processing");
assert.equal(resolveStripePayoutNextStatus("payout.paid", "paid"), "paid");
assert.equal(resolveStripePayoutNextStatus("payout.failed", "failed"), "failed");
assert.equal(resolveStripePayoutNextStatus("payout.canceled", "canceled"), "canceled");
assert.equal(resolveStripePayoutNextStatus("payout.updated", "canceled"), "canceled");
assert.equal(resolveStripePayoutNextStatus("payout.updated", "paid"), "paid");

console.log("stripeTransferPayoutWebhook.status ok");
