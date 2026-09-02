/**
 * Regression: Sunday bank payout audit fail-closed (P1-4).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const root = join(import.meta.dirname, "../../..");
const cron = readFileSync(
  join(root, "app/api/cron/driver-connect-bank-payouts/route.ts"),
  "utf8",
);
const bridge = readFileSync(
  join(root, "src/lib/finance/bankPayoutLedgerBridge.ts"),
  "utf8",
);

function test(name, fn) {
  fn();
  console.log(`ok ${name}`);
}

test("bank payout cron uses ensureSundayBankPayoutAuditRecord", () => {
  assert.match(cron, /ensureSundayBankPayoutAuditRecord/);
  assert.doesNotMatch(cron, /ledger write fail-open/);
});

test("bank payout cron marks reconcile_required on audit failure", () => {
  assert.match(cron, /reconcile_required: true/);
  assert.match(cron, /audit\.ok === false/);
});

test("bank payout bridge finds existing po_* before insert", () => {
  assert.match(bridge, /external_reference/);
  assert.match(bridge, /po_/);
  assert.match(bridge, /findBankPayoutAuditByPoId/);
});

console.log("bankPayoutLedgerBridge regression passed");
