/**
 * Wallet / earnings / cash out regression — Driver, Restaurant, Marketplace/Seller.
 * Static + constant guards for the completed → ledger → wallet → payout chain.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCommissionDisplayCents } from "../commissionDisplayCents";
import {
  DRIVER_CASHOUT_MINIMUM_CENTS,
} from "../driverWalletService";
import { MONEY_OUT_MODEL } from "./moneyOutArchitecture";
import {
  isRestaurantOrderAwaitingTransfer,
  restaurantAwaitingDollars,
} from "./restaurantWalletSoT";
import {
  isDriverBankPayoutWindow,
  sellerBankPayoutIdempotencyKey,
} from "./driverConnectBankPayout";
import {
  isManualCashoutAmountEligible,
  MANUAL_CASHOUT_MINIMUM_CENTS,
} from "./manualCashoutService";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "../../..");
const repoRoot = path.resolve(webRoot, "../..");

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("unified manual cash out has no dollar minimum — Instant amount > 0", () => {
  assert.equal(MANUAL_CASHOUT_MINIMUM_CENTS, 0);
  assert.equal(DRIVER_CASHOUT_MINIMUM_CENTS, 0);
  assert.equal(isManualCashoutAmountEligible(1), true, "$0.01 accepted if Instant");
  assert.equal(isManualCashoutAmountEligible(1999), true, "$19.99 accepted");
  assert.equal(isManualCashoutAmountEligible(2000), true, "$20.00 accepted");
  assert.equal(isManualCashoutAmountEligible(5000), true, "$50.00 accepted");
  assert.equal(isManualCashoutAmountEligible(0), false, "$0.00 refused");
});

test("driver cashout route uses WorkerFinance cash out entrypoint", () => {
  const route = fs.readFileSync(
    path.join(webRoot, "app/api/wallet/driver-cashout/route.ts"),
    "utf8",
  );
  assert.match(route, /executeWorkerCashOut/);
  assert.match(route, /from "@\/lib\/finance\/workerFinance"/);
  assert.match(route, /bodyDriverId !== driverUserId/);
  assert.match(route, /Driver role required/);
  assert.doesNotMatch(route, /isDriverCashoutRateLimited/);
});

test("restaurant and seller manual cashout routes exist", () => {
  const restaurant = fs.readFileSync(
    path.join(webRoot, "app/api/wallet/restaurant-cashout/route.ts"),
    "utf8",
  );
  const seller = fs.readFileSync(
    path.join(webRoot, "app/api/wallet/seller-cashout/route.ts"),
    "utf8",
  );
  assert.match(restaurant, /executeWorkerCashOut/);
  assert.match(seller, /executeWorkerCashOut/);
  assert.match(restaurant, /recipientType: "restaurant"/);
  assert.match(seller, /recipientType: "seller"/);
});

test("driver wallet SoT uses driver_transfer_id not driver_paid_out alone", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/driverWalletService.ts"),
    "utf8",
  );
  assert.match(src, /driver_transfer_id/);
  assert.match(src, /Never treat driver_paid_out/);
  assert.match(src, /marketplace_driver_payouts/);
});

test("restaurant Fouta Halal $5.36 SoT beats drifted fee_restaurant_cents $6.51", () => {
  const c = resolveCommissionDisplayCents({
    restaurant_cents: 536,
    restaurant_amount: 5.36,
    fee_restaurant_cents: 651,
  });
  assert.equal(c.restaurant_cents, 536);
  assert.notEqual(c.restaurant_cents, 651);
});

test("restaurant wallet uses restaurant_transfer_id SoT", () => {
  assert.equal(
    isRestaurantOrderAwaitingTransfer({
      status: "delivered",
      payment_status: "paid",
      restaurant_transfer_id: null,
    }),
    true,
  );
  assert.equal(
    isRestaurantOrderAwaitingTransfer({
      status: "delivered",
      payment_status: "paid",
      restaurant_transfer_id: "tr_rest",
    }),
    false,
  );
  assert.equal(
    isRestaurantOrderAwaitingTransfer({
      status: "delivered",
      payment_status: "paid",
      refund_status: "refunded",
      restaurant_transfer_id: null,
    }),
    false,
  );
  assert.equal(restaurantAwaitingDollars({ restaurant_cents: 536 }), 5.36);
});

test("all roles have Instant debit Cash Out + Sunday bank cron models", () => {
  assert.equal(
    MONEY_OUT_MODEL.driverCashout,
    "connect_instant_payout_full_balance_debit_card_no_minimum",
  );
  assert.equal(
    MONEY_OUT_MODEL.restaurantCashout,
    "connect_instant_payout_full_balance_debit_card_no_minimum",
  );
  assert.equal(
    MONEY_OUT_MODEL.sellerCashout,
    "connect_instant_payout_full_balance_debit_card_no_minimum",
  );
  assert.match(MONEY_OUT_MODEL.driverBankPayout, /sunday_0400/);
  assert.match(MONEY_OUT_MODEL.restaurantBankPayout, /sunday_0400/);
  assert.match(MONEY_OUT_MODEL.sellerBankPayout, /sunday_0400/);
});

test("Sunday 4:00 AM America/New_York bank payout window (EDT + EST)", () => {
  const sun4edt = new Date("2026-08-16T08:30:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun4edt), true);
  const sun5edt = new Date("2026-08-16T09:30:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun5edt), false);
  const sun4est = new Date("2026-01-11T09:15:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun4est), true);
});

test("seller Sunday bank idempotency key is stable per account+ET date", () => {
  assert.equal(
    sellerBankPayoutIdempotencyKey("acct_seller", "2026-08-16"),
    "seller_sunday_bank_payout:acct_seller:2026-08-16",
  );
});

test("marketplace seller payout service idempotency and live gates", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/marketplacePayoutService.ts"),
    "utf8",
  );
  assert.match(src, /idempotencyKey:\s*`mkt_seller_payout_/);
  assert.match(src, /MARKETPLACE_PAYOUTS_LIVE_ENABLED/);
});

test("seller connect security blocks client stripe_account_id tampering", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/finance/sellerConnectSecurity.regression.test.ts"),
    "utf8",
  );
  assert.match(src, /stripe_account_id/);
});

test("GitHub Actions schedules Sunday driver/restaurant bank payouts", () => {
  const wf = fs.readFileSync(
    path.join(repoRoot, ".github/workflows/production-driver-bank-payouts.yml"),
    "utf8",
  );
  assert.match(wf, /0 8 \* \* 0/);
  assert.match(wf, /0 9 \* \* 0/);
  assert.doesNotMatch(wf, /0 20 \* \* 0/);
  assert.doesNotMatch(wf, /0 21 \* \* 0/);
  assert.match(wf, /driver-connect-bank-payouts/);
});

test("transfers/run gates Connect before restaurant SCT", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "app/api/stripe/transfers/run/route.ts"),
    "utf8",
  );
  assert.match(src, /connect_not_ready/);
  assert.match(src, /restaurant_transfer_id/);
  assert.match(src, /idempotency/i);
});

test("wallet list reconciles po_* payouts against Stripe before display", () => {
  const list = fs.readFileSync(
    path.join(webRoot, "src/lib/payoutTransactionService.ts"),
    "utf8",
  );
  assert.match(list, /reconcileBankPayouts/);
  assert.match(list, /recipientUserId/);
  const rec = fs.readFileSync(
    path.join(webRoot, "src/lib/finance/reconcileBankPayouts.ts"),
    "utf8",
  );
  assert.match(rec, /payouts\.retrieve/);
  assert.match(rec, /resolveStripePayoutNextStatus/);
  assert.doesNotMatch(rec, /amount == 19\.08/);
});
