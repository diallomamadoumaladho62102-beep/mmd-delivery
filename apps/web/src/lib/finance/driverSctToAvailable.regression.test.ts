/**
 * Regression: completed Driver earning must leave awaiting_transfer via SCT.
 * Covers Food / Taxi / Package / Marketplace static path contracts + package orphan bridge.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "../../..");

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

function read(rel: string) {
  return fs.readFileSync(path.join(webRoot, rel), "utf8");
}

test("completed → SCT → Connect available → Wallet Available → Cash Out chain (driver)", () => {
  const wallet = read("src/lib/driverWalletService.ts");
  const cashout = read("app/api/wallet/driver-cashout/route.ts");
  const processPayouts = read("app/api/admin/process-payouts/route.ts");

  assert.match(wallet, /available_cents/);
  assert.match(wallet, /awaiting_transfer_cents/);
  assert.match(wallet, /fetchConnectUsdBalanceCents|connectAvailableCents/);
  assert.match(cashout, /executeWorkerCashOut/);
  assert.match(cashout, /from "@\/lib\/finance\/workerFinance"/);
  assert.match(processPayouts, /driver_transfer_id\.is\.null/);
  // Must NOT skip unpaid SCTs when MMD_PAYOUT_MODE=immediate
  assert.doesNotMatch(
    processPayouts,
    /payoutMode === "immediate"[\s\S]{0,120}skipped:\s*true/,
  );
});

test("Food completed → earning → SCT → Available (delivered-confirm + process-payouts retry)", () => {
  const delivered = read("app/api/orders/delivered-confirm/route.ts");
  const processPayouts = read("app/api/admin/process-payouts/route.ts");
  assert.match(delivered, /transfers\/run|triggerDriverPayout|driver/);
  assert.match(processPayouts, /target:\s*"driver"/);
  assert.match(processPayouts, /ensureOrphanPackageDriverSctOrders/);
});

test("Taxi completed → earning → SCT → Available", () => {
  const taxiCron = read("app/api/cron/taxi-payouts/route.ts");
  const wallet = read("src/lib/driverWalletService.ts");
  assert.match(taxiCron, /taxi/);
  assert.match(wallet, /taxi_commissions/);
  assert.match(wallet, /driver_transfer_id/);
});

test("Package completed → earning → SCT → Available (orphan bridge)", () => {
  const ensure = read("src/lib/finance/ensurePackageDriverSctOrder.ts");
  const deliveredPkg = read(
    "app/api/delivery-requests/delivered-confirm/route.ts",
  );
  const wallet = read("src/lib/driverWalletService.ts");
  const transfers = read("app/api/stripe/transfers/run/route.ts");

  assert.match(ensure, /ensurePackageDriverSctOrder/);
  assert.match(ensure, /unfunded_no_stripe_source/);
  assert.match(ensure, /payment_not_settled/);
  assert.match(ensure, /stripe_payment_intent_id/);
  assert.match(deliveredPkg, /ensurePackageDriverSctOrder/);
  // Wallet must not keep counting orphans after linked order exists
  assert.match(wallet, /linkedAny|linkedDeliveryRequestIds/);
  assert.match(wallet, /hasStripeSource|stripe_payment_intent_id/);
  // SCT success clears delivery_request awaiting
  assert.match(transfers, /delivery_request/);
  assert.match(transfers, /driver_paid_out:\s*true/);
});

test("Marketplace completed → earning → SCT → Available (auto-approve when live)", () => {
  const mkt = read("src/lib/marketplacePayoutService.ts");
  const jobs = read("src/lib/marketplaceDriverJobsService.ts");
  assert.match(mkt, /liveEnabled \? "approved" : "pending"|initialStatus/);
  assert.match(mkt, /status:\s*"approved"/);
  assert.match(mkt, /payout_live_enabled/);
  assert.match(jobs, /executeMarketplacePayouts|prepareMarketplaceDriverPayout/);
});

test("awaiting_transfer_cents must clear after SCT — not UI-relabeled as available", () => {
  const wallet = read("src/lib/driverWalletService.ts");
  // Available is Connect live balance; awaiting is unpaid transfer SoT
  assert.match(wallet, /connectAvailableCents|fetchConnectUsdBalanceCents/);
  assert.match(wallet, /awaitingTransferCents|computeDriverAvailableCents/);
  assert.doesNotMatch(
    wallet,
    /available_cents:\s*availableCents\s*\+\s*awaitingTransferCents/,
  );
});

test("syncPaidDeliveryRequestOrder copies Stripe PI for package SCT funding", () => {
  const sync = read("src/lib/deliveryRequestService.ts");
  assert.match(sync, /stripe_payment_intent_id/);
  assert.match(sync, /stripe_session_id/);
  assert.match(sync, /driver_delivery_payout/);
});

console.log("driverSctToAvailable.regression.test.ts OK");
