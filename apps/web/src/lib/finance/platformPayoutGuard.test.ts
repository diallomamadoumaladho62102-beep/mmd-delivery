import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPlatformBankPayoutAllowed,
  canFundDriverSctFromPlatformAvailable,
  classifyUnpaidDriverSctStatus,
  evaluatePlatformPayoutGuard,
  PLATFORM_PAYOUT_GUARD_BLOCK,
  PLATFORM_PAYOUT_GUARD_CLEAR,
} from "./platformPayoutGuardLogic";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../../..");

test("Test A/B: insufficient balance → pending, no transfer implied", () => {
  const c = classifyUnpaidDriverSctStatus({
    driverCents: 577,
    platformAvailableCents: -1579,
  });
  assert.equal(
    c.status,
    "driver_payment_pending_insufficient_platform_balance",
  );
  assert.equal(c.can_retry_now, false);
  assert.ok(c.action_required);
  assert.equal(
    canFundDriverSctFromPlatformAvailable({
      driverCents: 577,
      platformAvailableCents: -1579,
    }),
    false,
  );
});

test("Test C: available >= share → ready for SCT", () => {
  const c = classifyUnpaidDriverSctStatus({
    driverCents: 577,
    platformAvailableCents: 577,
  });
  assert.equal(c.status, "driver_payment_pending_ready_for_sct");
  assert.equal(c.can_retry_now, true);
});

test("Test G: unpaid SCT blocks platform payout", () => {
  assert.equal(
    evaluatePlatformPayoutGuard({ unpaidDriverCents: 577 }),
    PLATFORM_PAYOUT_GUARD_BLOCK,
  );
  const blocked = assertPlatformBankPayoutAllowed({ unpaidDriverCents: 577 });
  assert.equal(blocked.ok, false);
  if (blocked.ok === false) {
    assert.equal(blocked.error, "platform_payout_blocked_unpaid_driver_sct");
  }
});

test("Test H: zero unpaid clears platform payout guard", () => {
  assert.equal(
    evaluatePlatformPayoutGuard({ unpaidDriverCents: 0 }),
    PLATFORM_PAYOUT_GUARD_CLEAR,
  );
  assert.equal(
    assertPlatformBankPayoutAllowed({ unpaidDriverCents: 0 }).ok,
    true,
  );
});

test("transferred id short-circuits classification", () => {
  const c = classifyUnpaidDriverSctStatus({
    driverCents: 577,
    platformAvailableCents: -1,
    driverTransferId: "tr_abc",
  });
  assert.equal(c.status, "transferred");
  assert.equal(c.can_retry_now, false);
});

test("legacy_closed short-circuits classification without retry", () => {
  const c = classifyUnpaidDriverSctStatus({
    driverCents: 577,
    platformAvailableCents: 10_000,
    driverTransferId: null,
    sctClosureStatus: "legacy_closed",
  });
  assert.equal(c.status, "legacy_closed");
  assert.equal(c.can_retry_now, false);
});

test("taxi-payouts wires ensurePlatformManualPayoutSchedule on unpaid", () => {
  const src = fs.readFileSync(
    path.join(repoRoot, "apps/web/app/api/cron/taxi-payouts/route.ts"),
    "utf8",
  );
  assert.match(src, /ensurePlatformManualPayoutSchedule/);
  assert.match(src, /evaluatePlatformPayoutGuard/);
  assert.match(src, /platform_manual_payout/);
});

test("reconciliation API classifies balance_insufficient clearly", () => {
  const src = fs.readFileSync(
    path.join(
      repoRoot,
      "apps/web/app/api/admin/finance/driver-sct-reconciliation/route.ts",
    ),
    "utf8",
  );
  assert.match(src, /driver_payment_pending_insufficient_platform_balance/);
  assert.match(src, /ensure_manual/);
  assert.match(src, /platform_payouts_manual/);
  assert.match(src, /legacy_closed_items/);
});

console.log("platformPayoutGuard regression passed");
