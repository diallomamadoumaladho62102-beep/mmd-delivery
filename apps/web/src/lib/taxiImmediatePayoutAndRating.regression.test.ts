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
  assert.match(src, /assertClientOwnsTaxiRide/);
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
  assert.match(helper, /interval: "manual"/);
  assert.match(helper, /hour === 4/);
});

test("exact Sunday 4am ET is driven by GitHub Actions dual schedules", () => {
  const wf = fs.readFileSync(
    path.join(webRoot, "../../.github/workflows/production-driver-bank-payouts.yml"),
    "utf8",
  );
  assert.match(wf, /0 8 \* \* 0/);
  assert.match(wf, /0 9 \* \* 0/);
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
  assert.match(src, /executeTaxiDriverFareTransfer/);
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

test("cron hold default is zero", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "app/api/cron/taxi-payouts/route.ts"),
    "utf8",
  );
  assert.match(src, /DEFAULT_HOLD_HOURS = 0/);
});

console.log("taxiImmediatePayoutAndRating regression passed");
