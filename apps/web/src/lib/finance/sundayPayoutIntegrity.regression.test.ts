/**
 * Sunday payout integrity: timezone, same-Sunday catch-up, idempotency,
 * paid-only-after-Stripe, real-money SCT gates.
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

test("TEST 9 — Sunday 04:00 ET is the opening of the business window", () => {
  const sun4edt = new Date("2026-08-16T08:00:00.000Z");
  const parts = getNowPartsInTimeZone("America/New_York", sun4edt);
  assert.equal(parts.weekday, "Sun");
  assert.equal(parts.hour, 4);
  assert.equal(isDriverBankPayoutWindow(sun4edt), true);

  const sun4est = new Date("2026-01-11T09:00:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun4est), true);
});

test("TEST 9 — Saturday and Sunday before 04:00 ET never pay", () => {
  assert.equal(isDriverBankPayoutWindow(new Date("2026-08-16T03:59:00.000Z")), false);
  assert.equal(isDriverBankPayoutWindow(new Date("2026-08-16T07:59:00.000Z")), false);
  assert.equal(isDriverBankPayoutWindow(new Date("2026-08-17T08:00:00.000Z")), false);
});

test("same-Sunday delayed GH fire (08:00 ET) is still in window", () => {
  // 2026-09-06 production skip: local_hour=8 after GH delay
  const delayed = new Date("2026-09-06T12:29:00.000Z");
  const parts = getNowPartsInTimeZone("America/New_York", delayed);
  assert.equal(parts.weekday, "Sun");
  assert.equal(parts.hour, 8);
  assert.equal(isDriverBankPayoutWindow(delayed), true);
});

test("TEST 5/8 — idempotency key is unique per beneficiary + Sunday cycle", () => {
  const a = driverBankPayoutIdempotencyKey("acct_1", "2026-09-06");
  const b = driverBankPayoutIdempotencyKey("acct_1", "2026-09-06");
  const c = restaurantBankPayoutIdempotencyKey("acct_rest", "2026-09-06");
  assert.equal(a, b);
  assert.equal(a, "driver_sunday_bank_payout:acct_1:2026-09-06");
  assert.equal(c, "restaurant_sunday_bank_payout:acct_rest:2026-09-06");
  assert.notEqual(a, c);
});

test("TEST 6 — Sunday audit creates processing, never paid", () => {
  const bridge = fs.readFileSync(
    path.join(webRoot, "src/lib/finance/bankPayoutLedgerBridge.ts"),
    "utf8",
  );
  assert.match(bridge, /status: "processing"/);
  assert.doesNotMatch(bridge, /status: "paid"/);
});

test("TEST 3 — SCT and SCT retry exclude test/demo trips", () => {
  const transfer = fs.readFileSync(
    path.join(webRoot, "app/api/stripe/transfers/run/route.ts"),
    "utf8",
  );
  const process = fs.readFileSync(
    path.join(webRoot, "app/api/admin/process-payouts/route.ts"),
    "utf8",
  );
  const taxi = fs.readFileSync(
    path.join(webRoot, "src/lib/finance/executeTaxiDriverFareTransfer.ts"),
    "utf8",
  );
  const retry = fs.readFileSync(
    path.join(webRoot, "src/lib/finance/retryAwaitingConnectTransfers.ts"),
    "utf8",
  );
  assert.match(transfer, /realMoneyBlockReason/);
  assert.match(transfer, /real_money_excluded/);
  assert.match(process, /applyLiveTripFilters/);
  assert.match(process, /realMoneyBlockReason/);
  assert.match(taxi, /realMoneyBlockReason/);
  assert.match(retry, /realMoneyBlockReason/);
});

test("GH Actions keeps 04:00 ET triggers plus same-Sunday recovery", () => {
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

test("OWASP ZAP still builds, health-checks, and scans without bypass", () => {
  const zap = fs.readFileSync(
    path.join(repoRoot, ".github/workflows/owasp-zap.yml"),
    "utf8",
  );
  const script = fs.readFileSync(
    path.join(repoRoot, "scripts/owasp-zap-baseline.mjs"),
    "utf8",
  );
  assert.doesNotMatch(zap, /continue-on-error/);
  assert.match(zap, /owasp-zap-baseline\.mjs/);
  assert.match(zap, /health_check=ok/);
  assert.match(zap, /pnpm --dir apps\/web build/);
  assert.match(script, /zap-baseline.py/);
  assert.match(script, /high\.length > 0/);
});

console.log("sundayPayoutIntegrity tests passed");
