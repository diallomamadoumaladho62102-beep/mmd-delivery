/**
 * Instant Cash Out + Wallet 4-layer contracts.
 * Reference case: Connect pending $28.71 (Taxi $25.74 + Food $2.97) must never
 * be labeled Available unless Instant Payout eligibility resolves cashable.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function read(rel: string) {
  return fs.readFileSync(path.join(webRoot, rel), "utf8");
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("connectUsdBalance exposes instant_available separately from available/pending", () => {
  const src = read("src/lib/finance/connectUsdBalance.ts");
  assert.match(src, /instantAvailableCents/);
  assert.match(src, /instant_available/);
  assert.match(src, /availableCents/);
  assert.match(src, /pendingCents/);
});

test("driver wallet summary exposes confirmed / settling / awaiting / cashable layers", () => {
  const src = read("src/lib/driverWalletService.ts");
  assert.match(src, /confirmed_earnings_cents/);
  assert.match(src, /settling_cents/);
  assert.match(src, /awaiting_transfer_cents/);
  assert.match(src, /instant_available_cents/);
  assert.match(src, /instant_payout_eligible/);
  assert.match(src, /resolveManualCashoutFunding/);
  assert.doesNotMatch(
    src,
    /available_cents:\s*connectPendingCents/,
    "pending must not become available",
  );
});

test("restaurant/seller pending no longer merges awaiting SCT", () => {
  const src = read("src/lib/finance/unifiedWalletSummary.ts");
  assert.doesNotMatch(src, /pendingCents \+ awaitingTransferCents/);
  assert.match(src, /settling_cents:\s*connect\.pendingCents/);
  assert.match(src, /confirmed_earnings_cents/);
  assert.match(src, /cashableCents/);
});

test("$28.71 settlement reference stays settling not fake-available", () => {
  // Static invariant: cashable uses funding.cashableCents, settling uses pending.
  const driver = read("src/lib/driverWalletService.ts");
  assert.match(driver, /settlingCents = connectPendingCents/);
  assert.match(driver, /availableCents = stripeAccountId \? cashableCents : 0/);
});

test("Sunday bank payout remains standard available-only to bank (not Instant debit)", () => {
  const bank = read("src/lib/finance/driverConnectBankPayout.ts");
  assert.match(bank, /method:\s*["']standard["']/);
  assert.match(bank, /object:\s*["']bank_account["']/);
  assert.match(bank, /retrieveConnectBalance|available/);
});

console.log("instantCashoutWalletLayers.regression.test.ts OK");
