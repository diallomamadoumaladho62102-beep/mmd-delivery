import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isRestaurantOrderAwaitingTransfer,
  restaurantAwaitingDollars,
} from "./restaurantWalletSoT";
import { buildOrderTransferIdempotencyKey } from "./orderTransferGuards";
import { MONEY_OUT_MODEL } from "./moneyOutArchitecture";
import { restaurantBankPayoutIdempotencyKey } from "./driverConnectBankPayout";

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

test("restaurant wallet SoT gates on restaurant_transfer_id", () => {
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
      restaurant_transfer_id: "tr_abc",
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
  assert.equal(
    restaurantAwaitingDollars({ restaurant_cents: 1250, restaurant_net_amount: 0 }),
    12.5,
  );
});

test("restaurant financial overview uses transfer SoT not restaurant_paid_out alone", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/restaurantFinancialOverview.ts"),
    "utf8",
  );
  assert.match(src, /isRestaurantOrderAwaitingTransfer/);
  assert.match(src, /\.is\("restaurant_transfer_id", null\)/);
  assert.match(src, /\.not\("restaurant_transfer_id", "is", null\)/);
  assert.doesNotMatch(
    src,
    /\.or\("restaurant_paid_out\.is\.null,restaurant_paid_out\.eq\.false"\)/,
  );
});

test("transfers/run gates delivered + live Connect readiness", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "app/api/stripe/transfers/run/route.ts"),
    "utf8",
  );
  assert.match(src, /Order is not yet eligible for transfer/);
  assert.match(src, /connect_not_ready/);
  assert.match(src, /accounts\.retrieve\(destination\)/);
  assert.match(src, /restaurant_net_amount:/);
});

test("restaurant cancel executes Stripe refund immediately", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "app/api/orders/cancel/route.ts"),
    "utf8",
  );
  assert.match(src, /food_restaurant_cancel_refund_/);
  assert.match(src, /refundPaidFoodOrderOnCancel/);
  assert.doesNotMatch(src, /stripe_refund_deferred: true/);
});

test("restaurant bank payout is Sunday ET full available no \$20 min", () => {
  assert.equal(
    MONEY_OUT_MODEL.restaurantBankPayout,
    "sunday_0400_america_new_york_full_available_no_minimum",
  );
  assert.equal(
    restaurantBankPayoutIdempotencyKey("acct_x", "2026-08-16"),
    "restaurant_sunday_bank_payout:acct_x:2026-08-16",
  );
  const cron = fs.readFileSync(
    path.join(webRoot, "app/api/cron/driver-connect-bank-payouts/route.ts"),
    "utf8",
  );
  assert.match(cron, /restaurant_profiles/);
  assert.match(cron, /restaurantBankPayoutIdempotencyKey/);
  assert.match(cron, /scanned_restaurants/);
});

test("restaurant transfer idempotency changes after reverse", () => {
  const base = buildOrderTransferIdempotencyKey("ord-1", "restaurant");
  const after = buildOrderTransferIdempotencyKey("ord-1", "restaurant", "tr_rev");
  assert.equal(base, "transfer:ord-1:restaurant");
  assert.equal(after, "transfer:ord-1:restaurant:after:tr_rev");
});

test("mobile earnings never client-marks restaurant_paid_out", () => {
  const src = fs.readFileSync(
    path.join(
      repoRoot,
      "apps/mobile/src/screens/RestaurantEarningsScreen.tsx",
    ),
    "utf8",
  );
  assert.doesNotMatch(src, /restaurant_paid_out:\s*true/);
  assert.match(src, /restaurant_transfer_id/);
});

test("commission regional migration freezes paid commissions and food_africa", () => {
  const mig = fs.readFileSync(
    path.join(
      repoRoot,
      "supabase/migrations/20261118120000_refresh_order_commissions_regional_food.sql",
    ),
    "utf8",
  );
  assert.match(mig, /food_africa/);
  assert.match(mig, /food_default/);
  assert.match(mig, /refresh_order_commissions/);
  assert.match(mig, /transfer_ids_present/);
  assert.match(mig, /paid_with_snapshot/);
  assert.match(mig, /v_snap_country/);
  assert.doesNotMatch(mig, /^\s*TRUNCATE\b/im);
  assert.doesNotMatch(mig, /^\s*DELETE\s+FROM\b/im);
  assert.doesNotMatch(mig, /^\s*DROP\s+TABLE\b/im);
});

console.log("restaurantFinanceWalletPayout.regression passed");
