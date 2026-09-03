/**
 * Option A+B guards: Instant Cash Out precise reasons + Sunday 04:00 only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const root = join(import.meta.dirname, "../../../../../");
const unified = readFileSync(
  join(root, "apps/web/src/lib/finance/unifiedWalletSummary.ts"),
  "utf8",
);
const driverWallet = readFileSync(
  join(root, "apps/web/src/lib/driverWalletService.ts"),
  "utf8",
);
const hold = readFileSync(
  join(root, "apps/web/src/lib/finance/executeTaxiDriverFareTransfer.ts"),
  "utf8",
);
const bank = readFileSync(
  join(root, "apps/web/src/lib/finance/driverConnectBankPayout.ts"),
  "utf8",
);
const wf = readFileSync(
  join(root, ".github/workflows/production-driver-bank-payouts.yml"),
  "utf8",
);
const marketplace = readFileSync(
  join(root, "apps/web/src/lib/marketplacePayoutService.ts"),
  "utf8",
);
const moneyModel = readFileSync(
  join(root, "apps/web/src/lib/finance/moneyOutArchitecture.ts"),
  "utf8",
);
const mobileHelper = readFileSync(
  join(root, "apps/mobile/src/lib/instantCashoutBlockMessage.ts"),
  "utf8",
);

function test(name, fn) {
  fn();
  console.log(`ok ${name}`);
}

test("architecture remains separate charges + transfers (no destination/direct)", () => {
  assert.match(moneyModel, /platformToConnect:\s*"stripe_transfer_sct"/);
  assert.doesNotMatch(moneyModel, /destination_charges|direct_charges/);
});

test("TAXI_PAYOUT_HOLD_HOURS defaults to 0", () => {
  assert.match(hold, /TAXI_PAYOUT_HOLD_HOURS\s*\?\?\s*0/);
});

test("Sunday bank window is 04:00 ET only — no catch-up / no 16:00 cron", () => {
  assert.match(bank, /DRIVER_BANK_PAYOUT_PRIMARY_HOUR\s*=\s*4/);
  assert.doesNotMatch(bank, /DRIVER_BANK_PAYOUT_CATCHUP_HOUR/);
  assert.match(wf, /0 8 \* \* 0/);
  assert.match(wf, /0 9 \* \* 0/);
  assert.doesNotMatch(wf, /0 20 \* \* 0/);
  assert.doesNotMatch(wf, /0 21 \* \* 0/);
});

test("wallet cashout gate prefers precise Instant block reasons", () => {
  assert.match(unified, /instantBlockReason/);
  assert.match(unified, /instantBlockReason \|\| "instant_not_eligible"/);
  assert.match(driverWallet, /instantBlockReason \|\| "instant_not_eligible"/);
});

test("mobile Instant Cash Out messages distinguish settling vs missing dest", () => {
  assert.match(mobileHelper, /instant_available_zero/);
  assert.match(mobileHelper, /no_instant_payout_destination/);
  assert.match(mobileHelper, /Sunday 4:00 AM ET/);
  assert.doesNotMatch(mobileHelper, /4:00 PM|16:00/);
});

test("marketplace seller approval gate remains intentional", () => {
  assert.match(marketplace, /intentional fraud\/compliance gate|Sellers stay pending until admin approve/);
});

console.log("optionAB partner earnings guards passed");
