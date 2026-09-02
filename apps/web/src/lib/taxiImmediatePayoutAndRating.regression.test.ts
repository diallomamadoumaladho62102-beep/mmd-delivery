import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "../..");
const mobileRoot = path.resolve(__dirname, "../../../mobile");

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("rating route enforces completed ride and 1-5 stars", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "app/api/taxi/rides/[id]/rating/route.ts"),
    "utf8",
  );
  assert.match(src, /rating_must_be_1_to_5/);
  assert.match(src, /ride_not_completed/);
  assert.match(src, /taxi_ride_ratings/);
  assert.match(src, /only_client_rates_driver/);
  assert.match(src, /only_driver_rates_client/);
  assert.match(src, /cannot_rate_self/);
  assert.match(src, /rating_already_exists/);
});

test("sunday bank payout cron has no cashout minimum", () => {
  const cron = fs.readFileSync(
    path.join(webRoot, "app/api/cron/driver-connect-bank-payouts/route.ts"),
    "utf8",
  );
  const helper = fs.readFileSync(
    path.join(webRoot, "src/lib/finance/driverConnectBankPayout.ts"),
    "utf8",
  );
  assert.match(cron, /no_minimum_cents: true/);
  assert.match(cron, /America\/New_York/);
  assert.doesNotMatch(helper, /DRIVER_CASHOUT_MINIMUM/);
  assert.match(cron, /restaurant_profiles/);
  assert.match(cron, /restaurantBankPayoutIdempotencyKey/);
  assert.match(helper, /interval: "manual"/);
  assert.match(helper, /DRIVER_BANK_PAYOUT_PRIMARY_HOUR\s*=\s*4/);
  assert.match(helper, /DRIVER_BANK_PAYOUT_CATCHUP_HOUR\s*=\s*16/);
  assert.match(helper, /resolveDriverBankPayoutWindow/);
});

test("exact Sunday 4am ET is driven by GitHub Actions dual schedules", () => {
  const wf = fs.readFileSync(
    path.join(webRoot, "../../.github/workflows/production-driver-bank-payouts.yml"),
    "utf8",
  );
  assert.match(wf, /0 8 \* \* 0/);
  assert.match(wf, /0 9 \* \* 0/);
  assert.match(wf, /0 20 \* \* 0/);
  assert.match(wf, /0 21 \* \* 0/);
  assert.match(wf, /driver-connect-bank-payouts/);
  const root = fs.readFileSync(path.join(webRoot, "../../vercel.json"), "utf8");
  assert.doesNotMatch(root, /driver-connect-bank-payouts/);
});

test("receipt screen submits rating via API", () => {
  const src = fs.readFileSync(
    path.join(mobileRoot, "src/screens/taxi/TaxiReceiptScreen.tsx"),
    "utf8",
  );
  assert.match(src, /submitTaxiRideRating/);
  assert.match(src, /onSubmitRating/);
});

test("taxi earnings paid requires transfer id", () => {
  const src = fs.readFileSync(
    path.join(mobileRoot, "src/lib/taxiEarnings.ts"),
    "utf8",
  );
  assert.match(src, /driver_transfer_id/);
  assert.match(src, /transferred/);
});

test("complete triggers immediate fare transfer helper", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "app/api/taxi/rides/complete/route.ts"),
    "utf8",
  );
  const core = fs.readFileSync(
    path.join(webRoot, "src/lib/taxiCompleteRideCore.ts"),
    "utf8",
  );
  assert.match(src, /runTaxiRideCompletionSideEffects/);
  assert.match(core, /ensureWorkerConnectCredit/);
  assert.match(core, /vertical:\s*"taxi"/);
});

test("fare transfer guards block reversed idempotency replay", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/finance/executeTaxiDriverFareTransfer.ts"),
    "utf8",
  );
  assert.match(src, /stripe_transfer_reversed/);
  assert.match(src, /buildTaxiFareTransferIdempotencyKey/);
  assert.match(src, /transfers\.retrieve/);
});

test("rating API returns driver summary after insert", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "app/api/taxi/rides/[id]/rating/route.ts"),
    "utf8",
  );
  assert.match(src, /driver_rating_summary/);
});

test("complete does not select nonexistent taxi_rides.created_by", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "app/api/taxi/rides/complete/route.ts"),
    "utf8",
  );
  // Schema uses client_user_id only — selecting created_by masked PostgREST
  // errors as ride_not_found and broke Driver "Complete ride".
  const selectMatch = src.match(/\.select\(\s*`?["']([^"'`]+)["'`]/);
  assert.ok(selectMatch, "expected a taxi_rides .select(...) string");
  assert.doesNotMatch(selectMatch[1], /\bcreated_by\b/);
  assert.match(selectMatch[1], /\bclient_user_id\b/);
  assert.match(src, /rideLoadError/);
});

test("arrive and complete check driver ownership before proximity oracle", () => {
  const arrive = fs.readFileSync(
    path.join(webRoot, "app/api/taxi/rides/arrive/route.ts"),
    "utf8",
  );
  const complete = fs.readFileSync(
    path.join(webRoot, "app/api/taxi/rides/complete/route.ts"),
    "utf8",
  );
  assert.match(arrive, /assertDriverOwnsTaxiRide/);
  assert.match(complete, /assertDriverOwnsTaxiRide/);
  const arriveOwn = arrive.indexOf("assertDriverOwnsTaxiRide");
  const arriveProx = arrive.indexOf("assertTaxiPickupProximity");
  assert.ok(arriveOwn > 0 && arriveOwn < arriveProx);
  const completeOwn = complete.indexOf("assertDriverOwnsTaxiRide");
  const completeProx = complete.indexOf("assertTaxiDropoffProximity");
  assert.ok(completeOwn > 0 && completeOwn < completeProx);
});

test("fare transfer rejects non-acct_ destinations", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/finance/executeTaxiDriverFareTransfer.ts"),
    "utf8",
  );
  assert.match(src, /invalid_connect_account_id/);
  assert.match(src, /\^acct_\[A-Za-z0-9\]\+/);
});

test("cron hold default is zero", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "app/api/cron/taxi-payouts/route.ts"),
    "utf8",
  );
  assert.match(src, /DEFAULT_HOLD_HOURS = 0/);
});

console.log("taxiImmediatePayoutAndRating regression passed");
