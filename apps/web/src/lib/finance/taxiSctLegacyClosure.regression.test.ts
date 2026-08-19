/**
 * Regression: historical SCT closure ≠ payment; never triggers Stripe invent.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isTaxiSctHistoricallyClosed,
  taxiCommissionCountsAsUnpaidSct,
  TAXI_SCT_CLOSURE_LEGACY_CLOSED,
} from "./taxiSctClosure";
import { evaluateTaxiPayoutEligibility } from "../taxiPayoutEligibility";
import {
  classifyUnpaidDriverSctStatus,
  evaluatePlatformPayoutGuard,
  PLATFORM_PAYOUT_GUARD_BLOCK,
  PLATFORM_PAYOUT_GUARD_CLEAR,
} from "./platformPayoutGuardLogic";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "../../..");
const repoRoot = path.resolve(__dirname, "../../../../..");

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`fail - ${name}`);
    throw e;
  }
}

const openBase = {
  rideStatus: "completed",
  paymentStatus: "paid",
  refundStatus: null as string | null,
  driverId: "drv_1",
  driverCents: 577,
  driverPaidOut: false,
  driverTransferId: null as string | null,
  sctClosureStatus: null as string | null,
  completedAt: "2026-07-20T10:58:07.000Z",
  holdUntilMs: 0,
  nowMs: Date.parse("2026-08-19T00:00:00.000Z"),
  connectReady: true as boolean | null,
};

test("legacy_closed is historically closed, not paid", () => {
  assert.equal(isTaxiSctHistoricallyClosed("legacy_closed"), true);
  assert.equal(isTaxiSctHistoricallyClosed("reconciled"), true);
  assert.equal(isTaxiSctHistoricallyClosed(null), false);
  assert.equal(isTaxiSctHistoricallyClosed(undefined), false);
  assert.equal(isTaxiSctHistoricallyClosed(""), false);
});

test("$5.77 legacy_closed does not count as unpaid SCT", () => {
  assert.equal(
    taxiCommissionCountsAsUnpaidSct({
      driverTransferId: null,
      sctClosureStatus: TAXI_SCT_CLOSURE_LEGACY_CLOSED,
      driverCents: 577,
    }),
    false,
  );
});

test("open commission with null transfer still counts as unpaid", () => {
  assert.equal(
    taxiCommissionCountsAsUnpaidSct({
      driverTransferId: null,
      sctClosureStatus: null,
      driverCents: 1500,
    }),
    true,
  );
});

test("eligibility: legacy_closed blocks SCT (not alreadyPaid)", () => {
  const result = evaluateTaxiPayoutEligibility({
    ...openBase,
    sctClosureStatus: "legacy_closed",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "legacy_closed");
});

test("eligibility: null closure keeps normal open path", () => {
  const result = evaluateTaxiPayoutEligibility(openBase);
  assert.deepEqual(result, { ok: true, alreadyPaid: false });
});

test("classify: legacy_closed cannot retry", () => {
  const c = classifyUnpaidDriverSctStatus({
    driverCents: 577,
    platformAvailableCents: 10_000,
    driverTransferId: null,
    sctClosureStatus: "legacy_closed",
  });
  assert.equal(c.status, "legacy_closed");
  assert.equal(c.can_retry_now, false);
  assert.equal(c.action_required, null);
});

test("platform guard clears when unpaid inventory excludes legacy_closed", () => {
  assert.equal(
    evaluatePlatformPayoutGuard({ unpaidDriverCents: 577 }),
    PLATFORM_PAYOUT_GUARD_BLOCK,
  );
  assert.equal(
    evaluatePlatformPayoutGuard({ unpaidDriverCents: 0 }),
    PLATFORM_PAYOUT_GUARD_CLEAR,
  );
});

test("executeTaxiDriverFareTransfer rejects legacy_closed before Stripe SoT reuse", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/finance/executeTaxiDriverFareTransfer.ts"),
    "utf8",
  );
  assert.match(src, /isTaxiSctHistoricallyClosed/);
  assert.match(src, /error: "legacy_closed"/);
  const closedIdx = src.indexOf('error: "legacy_closed"');
  const existingIdx = src.indexOf("existingTransferId");
  assert.ok(closedIdx > 0 && existingIdx > closedIdx, "legacy_closed gate must precede transfer retrieve");
  const transfersCreateIdx = src.indexOf("transfers.create");
  assert.ok(closedIdx < transfersCreateIdx, "legacy_closed gate must precede transfers.create");
});

test("wallet awaiting excludes sct_closure_status null-only", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/driverWalletService.ts"),
    "utf8",
  );
  assert.match(src, /\.is\("sct_closure_status", null\)/);
  assert.match(src, /legacy_closed/);
});

test("cron taxi-payouts excludes legacy_closed from unpaid inventory", () => {
  const src = fs.readFileSync(
    path.join(repoRoot, "apps/web/app/api/cron/taxi-payouts/route.ts"),
    "utf8",
  );
  assert.match(src, /\.is\("sct_closure_status", null\)/);
  assert.match(src, /sct_closure_status/);
});

test("admin reconciliation excludes legacy_closed from unpaid", () => {
  const src = fs.readFileSync(
    path.join(
      repoRoot,
      "apps/web/app/api/admin/finance/driver-sct-reconciliation/route.ts",
    ),
    "utf8",
  );
  assert.match(src, /\.is\("sct_closure_status", null\)/);
  assert.match(src, /legacy_closed_items/);
  assert.match(src, /\.eq\("sct_closure_status", "legacy_closed"\)/);
  assert.match(src, /can_retry_now: false/);
});

test("migration scopes only the historical $5.77 commission", () => {
  const sql = fs.readFileSync(
    path.join(
      repoRoot,
      "supabase/migrations/20261119120000_taxi_commission_sct_legacy_closure.sql",
    ),
    "utf8",
  );
  assert.match(sql, /de802bdc-c8f3-4c97-b4ff-9c23cd2e52f3/);
  assert.match(sql, /8ad69f07-2f12-4a3e-9579-7a6a8333765a/);
  assert.match(sql, /driver_cents = 577/);
  assert.match(sql, /driver_transfer_id is null/);
  assert.match(sql, /coalesce\(driver_paid_out, false\) = false/);
  assert.match(sql, /sct_closure_status is null/);
  assert.match(sql, /sct_closure_status = 'legacy_closed'/);
  assert.match(sql, /get diagnostics v_updated = row_count/i);
  assert.match(sql, /v_updated > 1/);
  assert.match(sql, /UPDATE matched 0 and target is not already legacy_closed/);
  assert.match(sql, /legacy_closed/);
  assert.match(sql, /reconciled/);
  assert.match(sql, /commission_frozen_after_payout_or_legacy_closure/);
  assert.doesNotMatch(sql, /driver_paid_out\s*=\s*true/i);
  assert.doesNotMatch(sql, /driver_transfer_id\s*=\s*'tr_/);
  assert.doesNotMatch(sql, /\bdelete\s+from\b/i);
  assert.doesNotMatch(sql, /\btruncate\b/i);
  assert.doesNotMatch(sql, /update\s+public\.taxi_rides/i);
  assert.match(sql, /ROLLBACK/);
});

test("new open taxi commission (null closure) stays eligible awaiting path", () => {
  const open = evaluateTaxiPayoutEligibility({
    rideStatus: "completed",
    paymentStatus: "paid",
    refundStatus: null,
    driverId: "drv_new",
    driverCents: 1500,
    driverPaidOut: false,
    driverTransferId: null,
    sctClosureStatus: null,
    completedAt: "2026-08-19T00:00:00.000Z",
    holdUntilMs: 0,
    nowMs: Date.parse("2026-08-19T00:00:01.000Z"),
    connectReady: true,
  });
  assert.deepEqual(open, { ok: true, alreadyPaid: false });
  assert.equal(
    taxiCommissionCountsAsUnpaidSct({
      driverTransferId: null,
      sctClosureStatus: null,
      driverCents: 1500,
    }),
    true,
  );
  // After mock Transfer confirm → paid SoT
  assert.equal(
    taxiCommissionCountsAsUnpaidSct({
      driverTransferId: "tr_mock_new",
      sctClosureStatus: null,
      driverCents: 1500,
    }),
    false,
  );
  const paid = evaluateTaxiPayoutEligibility({
    rideStatus: "completed",
    paymentStatus: "paid",
    refundStatus: null,
    driverId: "drv_new",
    driverCents: 1500,
    driverPaidOut: true,
    driverTransferId: "tr_mock_new",
    sctClosureStatus: null,
    completedAt: "2026-08-19T00:00:00.000Z",
    holdUntilMs: 0,
    nowMs: Date.parse("2026-08-19T00:00:01.000Z"),
    connectReady: true,
  });
  assert.deepEqual(paid, { ok: true, alreadyPaid: true });
});

test("executeTaxiDriverFareTransfer: first stripe.* is after legacy_closed gate", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/finance/executeTaxiDriverFareTransfer.ts"),
    "utf8",
  );
  const gate = src.indexOf('error: "legacy_closed"');
  const firstStripe = src.indexOf("stripe.");
  assert.ok(gate > 0 && firstStripe > gate, "no stripe.* before legacy_closed return");
});

test("delivery/restaurant wallet SoT files untouched by taxi closure helper import", () => {
  const delivery = fs.readFileSync(
    path.join(webRoot, "src/lib/finance/deliveryWalletSoT.ts"),
    "utf8",
  );
  const restaurant = fs.readFileSync(
    path.join(webRoot, "src/lib/finance/restaurantWalletSoT.ts"),
    "utf8",
  );
  assert.doesNotMatch(delivery, /taxiSctClosure/);
  assert.doesNotMatch(restaurant, /taxiSctClosure/);
});

console.log("taxiSctLegacyClosure.regression passed");
