/**
 * Proves there is ONE WorkerFinance money-out engine — no parallel Cash Out / Sunday creators.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  CONNECT_INTERNAL_TRANSFER_METHOD_CODE,
  isConnectInternalTransferRef,
  isWorkerBankPayoutExternalRef,
  WORKER_FINANCE_PAYOUT_CREATE_ALLOWLIST,
} from "./workerFinance";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "../../..");
const repoRoot = path.resolve(webRoot, "../..");

function walkTsFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".next" ||
        entry.name === "dist" ||
        entry.name === "coverage"
      ) {
        continue;
      }
      walkTsFiles(full, out);
      continue;
    }
    if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test("stripe.payouts.create only in WorkerFinance allow-list modules", () => {
  const roots = [
    path.join(repoRoot, "apps/web/src"),
    path.join(repoRoot, "apps/web/app"),
    path.join(repoRoot, "supabase/functions"),
  ];
  const offenders: string[] = [];
  for (const root of roots) {
    for (const file of walkTsFiles(root)) {
      const rel = path.relative(repoRoot, file).replace(/\\/g, "/");
      if (rel.endsWith(".test.ts") || rel.endsWith(".regression.test.ts")) continue;
      if (rel.includes("/scripts/")) continue;
      const src = fs.readFileSync(file, "utf8");
      // Require an actual call site (open paren), ignore comments.
      if (!/stripe\.payouts\.create\s*\(/.test(src)) continue;
      const withoutBlockComments = src.replace(/\/\*[\s\S]*?\*\//g, "");
      const withoutLineComments = withoutBlockComments.replace(/\/\/.*$/gm, "");
      if (!/stripe\.payouts\.create\s*\(/.test(withoutLineComments)) continue;
      const allowed = WORKER_FINANCE_PAYOUT_CREATE_ALLOWLIST.some((a) => rel === a);
      if (!allowed) offenders.push(rel);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Unexpected stripe.payouts.create call sites: ${offenders.join(", ")}`,
  );
});

test("cashout routes + Sunday cron go through workerFinance only", () => {
  const driver = fs.readFileSync(
    path.join(webRoot, "app/api/wallet/driver-cashout/route.ts"),
    "utf8",
  );
  const restaurant = fs.readFileSync(
    path.join(webRoot, "app/api/wallet/restaurant-cashout/route.ts"),
    "utf8",
  );
  const seller = fs.readFileSync(
    path.join(webRoot, "app/api/wallet/seller-cashout/route.ts"),
    "utf8",
  );
  const sunday = fs.readFileSync(
    path.join(webRoot, "app/api/cron/driver-connect-bank-payouts/route.ts"),
    "utf8",
  );

  for (const [name, src] of [
    ["driver", driver],
    ["restaurant", restaurant],
    ["seller", seller],
  ] as const) {
    assert.match(src, /executeWorkerCashOut/, `${name} must use WorkerFinance`);
    assert.doesNotMatch(
      src,
      /executeManualConnectCashout/,
      `${name} must not call manualCashoutService directly`,
    );
    assert.doesNotMatch(src, /stripe\.payouts\.create\s*\(/);
  }

  assert.match(sunday, /executeWorkerSundayBankPayout/);
  assert.match(sunday, /lockWorkerConnectManualPayoutSchedule/);
  assert.doesNotMatch(sunday, /createFullAvailableConnectPayout\s*\(/);
  assert.doesNotMatch(sunday, /stripe\.payouts\.create\s*\(/);
  assert.doesNotMatch(
    sunday,
    /updatePayoutTransactionStatus\([^)]*,\s*"paid"/,
  );
});

test("legacy Edge money-out permanently disabled (no payouts.create)", () => {
  const payNow = fs.readFileSync(
    path.join(repoRoot, "supabase/functions/pay-driver-now/index.ts"),
    "utf8",
  );
  const process = fs.readFileSync(
    path.join(repoRoot, "supabase/functions/process_driver_payouts/index.ts"),
    "utf8",
  );
  assert.match(payNow, /permanently/i);
  assert.match(process, /permanently/i);
  assert.doesNotMatch(payNow, /stripe\.payouts\.create\s*\(/);
  assert.doesNotMatch(process, /stripe\.payouts\.create\s*\(/);
  assert.doesNotMatch(process, /stripe\.transfers\.create\s*\(/);
});

test("tr_* is never treated as worker bank payout; po_* is", () => {
  assert.equal(isWorkerBankPayoutExternalRef("po_abc"), true);
  assert.equal(isWorkerBankPayoutExternalRef("tr_abc"), false);
  assert.equal(isConnectInternalTransferRef("tr_abc"), true);
  assert.equal(isConnectInternalTransferRef("po_abc"), false);
  assert.equal(CONNECT_INTERNAL_TRANSFER_METHOD_CODE, "connect_internal_transfer");
});

test("wallet history lists only po_* bank/card payouts", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/payoutTransactionService.ts"),
    "utf8",
  );
  const fnStart = src.indexOf("export async function listPayoutTransactionsForUser");
  assert.ok(fnStart >= 0);
  const slice = src.slice(fnStart, fnStart + 1800);
  assert.match(slice, /reconcileBankPayouts/);
  assert.match(slice, /\.like\("external_reference", "po_%"\)/);
});

test("SCT bridge marks internal transfer, not Instant/Sunday cash out method", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/payoutExecutionBridge.ts"),
    "utf8",
  );
  assert.match(src, /connect_internal_transfer/);
  assert.match(src, /not_worker_bank_payout:\s*true/);
  assert.doesNotMatch(src, /methodCode:\s*"payout_stripe_connect_instant"/);
  assert.doesNotMatch(src, /methodCode:\s*"payout_stripe_connect_sunday"/);
});

console.log("workerFinance.singleEngine.regression.test.ts: ok");
