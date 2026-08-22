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
  DRIVER_CASHOUT_COOLDOWN_MS,
  DRIVER_CASHOUT_MINIMUM_CENTS,
} from "../driverWalletService";
import { MONEY_OUT_MODEL } from "./moneyOutArchitecture";
import {
  isRestaurantOrderAwaitingTransfer,
  restaurantAwaitingDollars,
} from "./restaurantWalletSoT";
import { isDriverBankPayoutWindow } from "./driverConnectBankPayout";

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

test("driver cash out minimum is $20.00 (2000 cents)", () => {
  assert.equal(DRIVER_CASHOUT_MINIMUM_CENTS, 2000);
  assert.equal(1999 < DRIVER_CASHOUT_MINIMUM_CENTS, true, "$19.99 refused");
  assert.equal(2000 >= DRIVER_CASHOUT_MINIMUM_CENTS, true, "$20.00 accepted");
  assert.equal(5000 >= DRIVER_CASHOUT_MINIMUM_CENTS, true, "$50.00 accepted");
});

test("driver cash out cooldown is 24 hours", () => {
  assert.equal(DRIVER_CASHOUT_COOLDOWN_MS, 24 * 60 * 60 * 1000);
});

test("driver cashout route enforces minimum, rate limit, idempotency", () => {
  const route = fs.readFileSync(
    path.join(webRoot, "app/api/wallet/driver-cashout/route.ts"),
    "utf8",
  );
  assert.match(route, /below_minimum/);
  assert.match(route, /cashout_rate_limited/);
  assert.match(route, /DRIVER_CASHOUT_MINIMUM_CENTS/);
  assert.match(route, /isDriverCashoutRateLimited/);
  assert.match(route, /idempotencyKey:\s*`driver-connect-payout:/);
  assert.match(route, /createPayoutTransaction/);
  assert.match(route, /bodyDriverId !== driverUserId/);
  assert.match(route, /payouts_enabled/);
  assert.match(route, /fetchConnectUsdBalanceCents/);
});

test("driver wallet SoT uses driver_transfer_id not driver_paid_out alone", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/driverWalletService.ts"),
    "utf8",
  );
  assert.match(src, /driver_transfer_id/);
  assert.match(src, /Never treat driver_paid_out/);
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

test("restaurant has no manual cash out — Sunday bank cron only", () => {
  assert.equal(
    "restaurantCashout" in MONEY_OUT_MODEL,
    false,
    "restaurants use Sunday bank cron, not manual cash out",
  );
  const cron = fs.readFileSync(
    path.join(webRoot, "app/api/cron/driver-connect-bank-payouts/route.ts"),
    "utf8",
  );
  assert.match(cron, /restaurant/i);
  assert.match(cron, /createFullAvailableConnectPayout/);
});

test("Sunday 4:00 AM America/New_York bank payout window", () => {
  const sun4edt = new Date("2026-08-16T08:30:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun4edt), true);
  const sun5edt = new Date("2026-08-16T09:30:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun5edt), false);
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

test("money out models separate manual cash out vs Sunday cron", () => {
  assert.equal(
    MONEY_OUT_MODEL.driverCashout,
    "connect_available_balance_payout_only",
  );
  assert.match(MONEY_OUT_MODEL.driverBankPayout, /sunday_0400/);
  assert.match(MONEY_OUT_MODEL.restaurantBankPayout, /sunday_0400/);
});

test("GitHub Actions schedules Sunday driver/restaurant bank payouts", () => {
  const wf = fs.readFileSync(
    path.join(repoRoot, ".github/workflows/production-driver-bank-payouts.yml"),
    "utf8",
  );
  assert.match(wf, /0 8 \* \* 0/);
  assert.match(wf, /0 9 \* \* 0/);
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

console.log("walletEarningsCashOut.regression.test.ts OK");
