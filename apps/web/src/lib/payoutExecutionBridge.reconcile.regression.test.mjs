/**
 * Regression: SCT succeeded → ledger reconcile path (P0-1).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const root = join(import.meta.dirname, "../..");
const transfersRun = readFileSync(
  join(root, "app/api/stripe/transfers/run/route.ts"),
  "utf8",
);
const bridge = readFileSync(
  join(root, "src/lib/payoutExecutionBridge.ts"),
  "utf8",
);

function test(name, fn) {
  fn();
  console.log(`ok ${name}`);
}

test("payoutExecutionBridge exports ledger reconcile helpers", () => {
  assert.match(bridge, /export async function isOrderTransferLedgerComplete/);
  assert.match(bridge, /export async function reconcileSuccessfulStripeOrderPayoutIfNeeded/);
});

test("transfers/run reconciles ledger on already_succeeded", () => {
  assert.match(transfersRun, /reconcileSuccessfulStripeOrderPayoutIfNeeded/);
  assert.match(transfersRun, /ledger_reconciled/);
  const block = transfersRun.slice(
    transfersRun.indexOf('if (payout.status === "succeeded" && payout.stripe_transfer_id)'),
    transfersRun.indexOf("if (") > transfersRun.indexOf('if (payout.status === "succeeded"')
      ? transfersRun.indexOf("if (\n      payout.amount_cents !== amount", transfersRun.indexOf('if (payout.status === "succeeded"'))
      : transfersRun.indexOf("if (\n      payout.amount_cents !== amount"),
  );
  assert.match(block, /reconcileSuccessfulStripeOrderPayoutIfNeeded/);
});

test("transfers/run returns reconcile_required when ledger incomplete", () => {
  assert.match(transfersRun, /reconcile_required: true/);
  assert.match(transfersRun, /ledger_still_incomplete_after_reconcile|wallet ledger reconcile failed/);
});

console.log("payoutExecutionBridge reconcile regression passed");
