/**
 * Platform Manual payouts + Package SCT balance_insufficient contracts.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canFundDriverSctFromPlatformAvailable,
  classifyUnpaidDriverSctStatus,
} from "./platformPayoutGuardLogic";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("platform available -$15.79 cannot fund Package $4.56 SCT", () => {
  assert.equal(
    canFundDriverSctFromPlatformAvailable({
      driverCents: 456,
      platformAvailableCents: -1579,
    }),
    false,
  );
  const classified = classifyUnpaidDriverSctStatus({
    driverCents: 456,
    platformAvailableCents: -1579,
    driverTransferId: null,
  });
  assert.equal(
    classified.status,
    "driver_payment_pending_insufficient_platform_balance",
  );
  assert.match(
    String(classified.action_required),
    /ensure_platform_payouts_manual/,
  );
  assert.equal(classified.can_retry_now, false);
});

test("platform available ≥ 456¢ can fund Package SCT", () => {
  assert.equal(
    canFundDriverSctFromPlatformAvailable({
      driverCents: 456,
      platformAvailableCents: 456,
    }),
    true,
  );
});

test("process-payouts attempts platform Manual schedule before SCT loop", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "app/api/admin/process-payouts/route.ts"),
    "utf8",
  );
  assert.match(src, /ensurePlatformManualPayoutSchedule/);
  assert.match(src, /platform_payout_schedule/);
  assert.match(src, /ensureOrphanPackageDriverSctOrders/);
});

test("transfers/run surfaces balance_insufficient with requires_dashboard", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "app/api/stripe/transfers/run/route.ts"),
    "utf8",
  );
  assert.match(src, /balance_insufficient/);
  assert.match(src, /requires_dashboard/);
  assert.match(src, /Set platform Stripe payouts to Manual/);
});

test("Instant dry-run script refuses real payout without founder app confirmation", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "scripts/instant-cashout-dry-run.mjs"),
    "utf8",
  );
  assert.match(src, /CONFIRM_INSTANT_CASHOUT|REFUSING/);
  assert.match(src, /dry_run_read_only/);
  assert.doesNotMatch(src, /payouts\.create/);
});

console.log("platformManualSctBalance.regression.test.ts OK");
