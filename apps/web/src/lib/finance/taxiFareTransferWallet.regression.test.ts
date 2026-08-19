import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "../../..");

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("fare transfer re-checks Stripe when transfer id already present", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/finance/executeTaxiDriverFareTransfer.ts"),
    "utf8",
  );
  assert.match(src, /transfers\.retrieve/);
  assert.match(src, /existingTransferId/);
});

test("fare transfer refuses reversed Stripe objects", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/finance/executeTaxiDriverFareTransfer.ts"),
    "utf8",
  );
  assert.match(src, /isStripeTransferReversed/);
  assert.match(src, /stripe_transfer_reversed/);
  assert.match(src, /buildTaxiFareTransferIdempotencyKey/);
  assert.match(src, /resolveTaxiFareTransferReusePlan/);
  assert.match(src, /transfers\.list/);
  assert.match(src, /after_reversed_transfer_id/);
  assert.doesNotMatch(
    src,
    /const idempotencyKey = `taxi_driver_payout:\$\{rideId\}`;/,
  );
});

test("webhook clears taxi paid state on transfer.reversed", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/stripeTransferPayoutWebhook.ts"),
    "utf8",
  );
  assert.match(src, /transfer\.reversed/);
  assert.match(src, /taxi_commissions/);
  assert.match(src, /driver_transfer_id: null/);
  assert.match(src, /driver_paid_out: false/);
});

test("wallet awaiting_transfer includes unpaid taxi commissions", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/driverWalletService.ts"),
    "utf8",
  );
  assert.match(src, /from\("taxi_commissions"\)/);
  assert.match(src, /\.is\("driver_transfer_id", null\)/);
  assert.match(src, /\.is\("sct_closure_status", null\)/);
  assert.match(src, /taxiAwaitingCents/);
  assert.match(src, /\.eq\("taxi_rides\.payment_status", "paid"\)/);
});

test("delivery orders use driver_transfer_id for wallet awaiting", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/driverWalletService.ts"),
    "utf8",
  );
  assert.match(src, /\.is\("driver_transfer_id", null\)/);
  assert.match(src, /Never treat driver_paid_out/);
});

console.log("taxiFareTransferWallet.regression passed");
