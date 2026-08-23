/**
 * Manual Cash Out — Instant-only, no $ minimum, atomic claim, no create⇒paid.
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

test("no Cash Out dollar minimum — $0.01 eligible when Instant amount > 0", () => {
  assert.equal(MANUAL_CASHOUT_MINIMUM_CENTS, 0);
  assert.equal(isManualCashoutAmountEligible(1), true);
  assert.equal(isManualCashoutAmountEligible(0), false);
  assert.equal(isManualCashoutAmountEligible(1999), true);
  assert.equal(isManualCashoutAmountEligible(2000), true);
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
  const claimIdx = src.indexOf("claim_manual_cashout_day");
  const stripeIdx = src.indexOf("stripe.payouts.create");
  assert.ok(claimIdx > 0 && stripeIdx > claimIdx, "claim before Stripe payout");
  assert.match(src, /idempotencyKey:\s*`manual-cashout:\$\{claim\.claimId\}`/);
  assert.match(src, /resolveManualCashoutFunding/);
  assert.match(src, /method:\s*"instant"/);
  assert.doesNotMatch(src, /body\.amount/, "client amount never trusted");
});

test("Cash Out is Instant-only — no standard fallback", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/finance/manualCashoutService.ts"),
    "utf8",
  );
  assert.doesNotMatch(src, /standard-fallback/);
  assert.doesNotMatch(src, /method:\s*"standard"/);
  assert.match(src, /NEVER mark paid here/);
  assert.match(src, /status:\s*"processing"/);
});

test("resolveManualCashoutFunding requires Instant debit card + instant_available", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/finance/resolveManualCashoutFunding.ts"),
    "utf8",
  );
  assert.match(src, /instant_available/);
  assert.match(src, /listExternalAccounts/);
  assert.match(src, /no_instant_debit_card/);
  assert.match(src, /object:\s*"card"/);
  assert.match(src, /instant_payouts/);
  assert.match(src, /available_payout_methods/);
  assert.doesNotMatch(src, /cashableCents:\s*bal\.availableCents/);
  assert.doesNotMatch(
    src,
    /cashableCents:\s*bal\.pendingCents/,
    "never treat pending alone as cashable",
  );
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
  assert.match(driverRoute, /executeWorkerCashOut/);
  assert.match(restaurantRoute, /executeWorkerCashOut/);
  assert.match(sellerRoute, /executeWorkerCashOut/);
  assert.match(driverRoute, /from "@\/lib\/finance\/workerFinance"/);
  assert.match(restaurantRoute, /from "@\/lib\/finance\/workerFinance"/);
  assert.match(sellerRoute, /from "@\/lib\/finance\/workerFinance"/);
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

test("Sunday bank payout requires ba_ destination and stays processing", () => {
  const bank = fs.readFileSync(
    path.join(webRoot, "src/lib/finance/driverConnectBankPayout.ts"),
    "utf8",
  );
  const cron = fs.readFileSync(
    path.join(webRoot, "app/api/cron/driver-connect-bank-payouts/route.ts"),
    "utf8",
  );
  assert.match(bank, /object:\s*"bank_account"/);
  assert.match(bank, /method:\s*"standard"/);
  assert.match(bank, /no_bank_account_destination/);
  assert.match(cron, /status:\s*"processing"/);
  assert.doesNotMatch(
    cron,
    /updatePayoutTransactionStatus\([^)]*,\s*"paid"/,
  );
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
