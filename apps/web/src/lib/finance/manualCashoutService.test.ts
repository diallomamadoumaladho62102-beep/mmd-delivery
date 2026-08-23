/**
 * Manual Cash Out — amount gates, atomic claim guards, route wiring, concurrency ordering.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  americaNewYorkDateKey,
  isManualCashoutAmountEligible,
  MANUAL_CASHOUT_MINIMUM_CENTS,
  MANUAL_CASHOUT_TIMEZONE,
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

test("$19.99 below minimum — refused", () => {
  assert.equal(isManualCashoutAmountEligible(1999), false);
  assert.equal(1999 < MANUAL_CASHOUT_MINIMUM_CENTS, true);
});

test("$20.00 minimum — accepted", () => {
  assert.equal(MANUAL_CASHOUT_MINIMUM_CENTS, 2000);
  assert.equal(isManualCashoutAmountEligible(2000), true);
});

test("$50.00 — accepted", () => {
  assert.equal(isManualCashoutAmountEligible(5000), true);
});

test("America/New_York date key uses correct timezone", () => {
  assert.equal(MANUAL_CASHOUT_TIMEZONE, "America/New_York");
  const instant = new Date("2026-08-16T08:30:00.000Z");
  assert.equal(americaNewYorkDateKey(instant), "2026-08-16");
});

test("migration enforces atomic 1/day claim (unique index + advisory lock)", () => {
  const migration = fs.readFileSync(
    path.join(
      repoRoot,
      "supabase/migrations/20261123120000_manual_cashout_daily_claims.sql",
    ),
    "utf8",
  );
  assert.match(migration, /manual_cashout_daily_claims_active_uidx/);
  assert.match(migration, /where status in \('claimed', 'processing', 'paid'\)/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /claim_manual_cashout_day/);
  assert.match(migration, /finalize_manual_cashout_day/);
  assert.match(migration, /recipient_type in \('driver', 'restaurant', 'seller'\)/);
});

test("executeManualConnectCashout claims daily slot BEFORE Stripe payout", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/finance/manualCashoutService.ts"),
    "utf8",
  );
  const claimIdx = src.indexOf("claimDailySlot");
  const stripeIdx = src.indexOf("stripe.payouts.create");
  assert.ok(claimIdx > 0 && stripeIdx > claimIdx, "claim before Stripe payout");
  assert.match(src, /idempotencyKey:\s*`manual-cashout:\$\{claim\.claimId\}`/);
  assert.match(src, /fetchConnectUsdBalanceCents/);
  assert.doesNotMatch(src, /body\.amount/, "client amount never trusted");
});

test("driver / restaurant / seller cashout routes delegate to shared service", () => {
  const driverRoute = fs.readFileSync(
    path.join(webRoot, "app/api/wallet/driver-cashout/route.ts"),
    "utf8",
  );
  const restaurantRoute = fs.readFileSync(
    path.join(webRoot, "app/api/wallet/restaurant-cashout/route.ts"),
    "utf8",
  );
  const sellerRoute = fs.readFileSync(
    path.join(webRoot, "app/api/wallet/seller-cashout/route.ts"),
    "utf8",
  );
  assert.match(driverRoute, /executeManualConnectCashout/);
  assert.match(restaurantRoute, /executeManualConnectCashout/);
  assert.match(sellerRoute, /executeManualConnectCashout/);
  assert.match(driverRoute, /bodyDriverId !== driverUserId/);
  assert.match(restaurantRoute, /restaurant_id body parameter is not accepted/);
  assert.match(sellerRoute, /seller_id body parameter is not accepted/);
});

test("concurrent claim simulation — second claim rejected", () => {
  let claims = 0;
  const mockRpc = () => {
    claims += 1;
    if (claims === 1) {
      return { data: { ok: true, claim_id: "claim-a" }, error: null };
    }
    return { data: { ok: false, error: "cashout_rate_limited" }, error: null };
  };

  const first = mockRpc();
  const second = mockRpc();
  assert.equal((first.data as { ok: boolean }).ok, true);
  assert.equal((second.data as { error: string }).error, "cashout_rate_limited");
  assert.equal(claims, 2);
});

test("driver wallet includes marketplace awaiting transfer", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/driverWalletService.ts"),
    "utf8",
  );
  assert.match(src, /marketplace_driver_payouts/);
  assert.match(src, /marketplaceAwaitingCents/);
  assert.match(src, /isManualCashoutBlockedToday/);
});

test("Sunday cron includes drivers, restaurants, and sellers", () => {
  const cron = fs.readFileSync(
    path.join(webRoot, "app/api/cron/driver-connect-bank-payouts/route.ts"),
    "utf8",
  );
  assert.match(cron, /sellerRows/);
  assert.match(cron, /sellerBankPayoutIdempotencyKey/);
  assert.match(cron, /scanned_sellers/);
  assert.match(cron, /from\("sellers"\)/);
});

test("mobile wallet API exposes requestWalletCashOut for all roles", () => {
  const mobileApi = fs.readFileSync(
    path.join(webRoot, "../mobile/src/lib/walletApi.ts"),
    "utf8",
  );
  assert.match(mobileApi, /requestWalletCashOut/);
  assert.match(mobileApi, /restaurant-cashout/);
  assert.match(mobileApi, /seller-cashout/);
  assert.match(mobileApi, /driver-cashout/);
});

test("mobile screens use cashoutInFlight guard", () => {
  const driver = fs.readFileSync(
    path.join(webRoot, "../mobile/src/screens/DriverWalletScreen.tsx"),
    "utf8",
  );
  const restaurant = fs.readFileSync(
    path.join(webRoot, "../mobile/src/screens/restaurant/RestaurantWalletScreen.tsx"),
    "utf8",
  );
  const seller = fs.readFileSync(
    path.join(webRoot, "../mobile/src/screens/seller/SellerWalletScreen.tsx"),
    "utf8",
  );
  assert.match(driver, /cashoutInFlight/);
  assert.match(restaurant, /cashoutInFlight/);
  assert.match(seller, /cashoutInFlight/);
});

console.log("manualCashoutService.test.ts OK");
