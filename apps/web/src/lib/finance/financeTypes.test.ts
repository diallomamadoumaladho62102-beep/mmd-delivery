import assert from "node:assert/strict";
import { financeIdempotencyKey } from "@/lib/finance/financeTypes";
import { FINANCE_MODULES } from "@/lib/finance/financeTypes";

assert.equal(
  financeIdempotencyKey(["payment", "food", "ord-1", "pi_1"]),
  "finance:payment:food:ord-1:pi_1"
);
assert.equal(
  financeIdempotencyKey(["payment", "food", "ord-1", "pi_1"]),
  financeIdempotencyKey(["payment", "food", "ord-1", "pi_1"])
);
assert.ok(FINANCE_MODULES.includes("overview"));
assert.ok(FINANCE_MODULES.includes("ledger"));
assert.ok(FINANCE_MODULES.includes("reconciliation"));

// Double-entry balance helper (mirrors RPC expectation)
function balanced(lines: Array<{ debit_cents: number; credit_cents: number }>) {
  const d = lines.reduce((a, l) => a + l.debit_cents, 0);
  const c = lines.reduce((a, l) => a + l.credit_cents, 0);
  return d > 0 && d === c;
}

assert.equal(
  balanced([
    { debit_cents: 1000, credit_cents: 0 },
    { debit_cents: 0, credit_cents: 700 },
    { debit_cents: 0, credit_cents: 300 },
  ]),
  true
);
assert.equal(
  balanced([
    { debit_cents: 1000, credit_cents: 0 },
    { debit_cents: 0, credit_cents: 900 },
  ]),
  false
);

console.log("financeTypes.test.ts: ok");
