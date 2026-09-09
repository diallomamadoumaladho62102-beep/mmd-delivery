/**
 * Tests A–M: Sunday payout window, idempotency, Connect missing,
 * pending vs available, real vs fake money, weekday skip.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  driverBankPayoutIdempotencyKey,
  getNowPartsInTimeZone,
  isDriverBankPayoutWindow,
  restaurantBankPayoutIdempotencyKey,
} from "./driverConnectBankPayout";
import {
  classifyAvailableVsPending,
  classifyStripeConnectAccountId,
  classifySundayBankDbEligibility,
  sundayBankBlockLabel,
  SUNDAY_BANK_SKIP_REASONS,
} from "./sundayBankEligibility";
import {
  isRealMoneyFinancialSource,
  realMoneyBlockReason,
} from "./realMoneyGuard";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "../../..");
const repoRoot = path.resolve(webRoot, "../..");

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`fail - ${name}`);
    throw e;
  }
}

const realPaid = {
  is_test: false,
  hidden_from_user: false,
  archived_at: null,
  payment_status: "paid",
  status: "delivered",
};

test("TEST A — real driver earning source is real money", () => {
  assert.equal(isRealMoneyFinancialSource(realPaid), true);
  assert.equal(realMoneyBlockReason(realPaid), null);
});

test("TEST B — real restaurant paid order is real money", () => {
  assert.equal(
    isRealMoneyFinancialSource({ ...realPaid, status: "completed" }),
    true,
  );
});

test("TEST C — fake/test order cannot become real earnings or payout", () => {
  const fake = { ...realPaid, is_test: true };
  assert.equal(isRealMoneyFinancialSource(fake), false);
  assert.equal(realMoneyBlockReason(fake), "test_or_demo_excluded");
});

test("TEST D — real + fake mix: only real money counts", () => {
  assert.equal(isRealMoneyFinancialSource(realPaid), true);
  assert.equal(isRealMoneyFinancialSource({ ...realPaid, is_test: true }), false);
});

test("TEST E — unpaid order is not real money", () => {
  assert.equal(
    isRealMoneyFinancialSource({ ...realPaid, payment_status: "unpaid" }),
    false,
  );
  assert.equal(
    realMoneyBlockReason({ ...realPaid, payment_status: "unpaid" }),
    "payment_not_confirmed",
  );
});

test("TEST F — refunded order is excluded", () => {
  assert.equal(
    isRealMoneyFinancialSource({ ...realPaid, refund_status: "refunded" }),
    false,
  );
  assert.equal(
    realMoneyBlockReason({ ...realPaid, refund_status: "refunded" }),
    "refund_or_dispute_excluded",
  );
});

test("TEST G — duplicate cron uses the same Sunday idempotency key", () => {
  const a = driverBankPayoutIdempotencyKey("acct_drv", "2026-09-13");
  const b = driverBankPayoutIdempotencyKey("acct_drv", "2026-09-13");
  const rest = restaurantBankPayoutIdempotencyKey("acct_rest", "2026-09-13");
  assert.equal(a, b);
  assert.equal(a, "driver_sunday_bank_payout:acct_drv:2026-09-13");
  assert.notEqual(a, rest);
  const cron = fs.readFileSync(
    path.join(webRoot, "app/api/cron/driver-connect-bank-payouts/route.ts"),
    "utf8",
  );
  assert.match(cron, /withCronJobLock/);
  assert.match(cron, /idempotencyKey/);
});

test("TEST H — retry stays on the same Stripe idempotency key + po_ ledger lookup", () => {
  const bridge = fs.readFileSync(
    path.join(webRoot, "src/lib/finance/bankPayoutLedgerBridge.ts"),
    "utf8",
  );
  assert.match(bridge, /findBankPayoutAuditByPoId/);
  assert.match(bridge, /status: "processing"/);
  assert.doesNotMatch(bridge, /status: "paid"/);
  const bank = fs.readFileSync(
    path.join(webRoot, "src/lib/finance/driverConnectBankPayout.ts"),
    "utf8",
  );
  assert.match(bank, /idempotencyKey: params.idempotencyKey/);
});

test("TEST I — available=0 does not create a payout; pending funds are preserved", () => {
  const pendingOnly = classifyAvailableVsPending({
    availableCents: 0,
    pendingCents: 4200,
  });
  assert.equal(pendingOnly.eligible, false);
  assert.equal(pendingOnly.reason, "pending_funds_settling");
  const zero = classifyAvailableVsPending({
    availableCents: 0,
    pendingCents: 0,
  });
  assert.equal(zero.eligible, false);
  assert.equal(zero.reason, "zero_available_balance");
  const payable = classifyAvailableVsPending({
    availableCents: 1500,
    pendingCents: 800,
  });
  assert.equal(payable.eligible, true);
  const bank = fs.readFileSync(
    path.join(webRoot, "src/lib/finance/driverConnectBankPayout.ts"),
    "utf8",
  );
  assert.match(bank, /pending_funds_settling|classifyAvailableVsPending/);
  assert.doesNotMatch(bank, /amount:\s*0/);
});

test("TEST J — missing Stripe Connect is PAYOUT BLOCKED, not $0 paid", () => {
  const missing = classifyStripeConnectAccountId(null);
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "missing_stripe_account");
  assert.equal(
    sundayBankBlockLabel(missing.reason),
    "PAYOUT BLOCKED — STRIPE CONNECT ACCOUNT NOT CONFIGURED",
  );
  const db = classifySundayBankDbEligibility({ stripe_account_id: null });
  assert.equal(db.eligible, false);
  assert.equal(db.reason, SUNDAY_BANK_SKIP_REASONS.MISSING_STRIPE_ACCOUNT);
  const cron = fs.readFileSync(
    path.join(webRoot, "app/api/cron/driver-connect-bank-payouts/route.ts"),
    "utf8",
  );
  assert.match(cron, /missing_stripe_account/);
  assert.match(cron, /PAYOUT BLOCKED/);
  const adminApi = fs.readFileSync(
    path.join(webRoot, "app/api/admin/payouts/sunday-eligibility/route.ts"),
    "utf8",
  );
  assert.match(adminApi, /payout_stripe_connect_sunday/);
  assert.match(adminApi, /last_payout_status/);
});

test("TEST K — late Sunday scheduler (08:00 ET) still catches up", () => {
  const delayed = new Date("2026-09-06T12:29:00.000Z");
  const parts = getNowPartsInTimeZone("America/New_York", delayed);
  assert.equal(parts.weekday, "Sun");
  assert.equal(parts.hour, 8);
  assert.equal(isDriverBankPayoutWindow(delayed), true);
});

test("TEST L — weekday never opens the Sunday bank window", () => {
  assert.equal(isDriverBankPayoutWindow(new Date("2026-09-09T12:00:00.000Z")), false);
  assert.equal(isDriverBankPayoutWindow(new Date("2026-09-08T08:00:00.000Z")), false);
  assert.equal(isDriverBankPayoutWindow(new Date("2026-09-07T08:00:00.000Z")), false);
});

test("TEST M — America/New_York DST: 04:00 EDT and 04:00 EST", () => {
  const edt = new Date("2026-08-16T08:00:00.000Z");
  const est = new Date("2026-01-11T09:00:00.000Z");
  assert.equal(getNowPartsInTimeZone("America/New_York", edt).hour, 4);
  assert.equal(getNowPartsInTimeZone("America/New_York", est).hour, 4);
  assert.equal(isDriverBankPayoutWindow(edt), true);
  assert.equal(isDriverBankPayoutWindow(est), true);
});

test("cancelled orders are excluded from real money", () => {
  assert.equal(
    isRealMoneyFinancialSource({ ...realPaid, status: "cancelled" }),
    false,
  );
  assert.equal(
    realMoneyBlockReason({ ...realPaid, status: "canceled" }),
    "cancelled_excluded",
  );
});

test("GH Actions Sunday recoveries cover late fires and never 16:00 ET", () => {
  const wf = fs.readFileSync(
    path.join(repoRoot, ".github/workflows/production-driver-bank-payouts.yml"),
    "utf8",
  );
  assert.match(wf, /0 8 \* \* 0/);
  assert.match(wf, /0 9 \* \* 0/);
  assert.match(wf, /0 12 \* \* 0/);
  assert.match(wf, /0 14 \* \* 0/);
  assert.match(wf, /0 16 \* \* 0/);
  assert.match(wf, /0 22 \* \* 0/);
  assert.doesNotMatch(wf, /0 20 \* \* 0/);
  assert.doesNotMatch(wf, /0 21 \* \* 0/);
});

console.log("sundayBankEligibility tests passed");
