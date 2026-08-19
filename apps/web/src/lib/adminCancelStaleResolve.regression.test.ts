import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

test("admin cancel order core refuses execution evidence", () => {
  const src = fs.readFileSync(
    path.join(repoRoot, "apps/web/src/lib/adminCancelOrderRefundCore.ts"),
    "utf8",
  );
  assert.match(src, /picked_up_at/);
  assert.match(src, /delivered_at/);
  assert.match(src, /Force Complete, not Cancel/);
  assert.match(src, /idempotencyKey: `admin_cancel_refund_\$\{orderId\}`/);
  assert.match(src, /alreadyCanceled/);
});

test("admin cancel delivery core refuses pickup/dropoff evidence", () => {
  const src = fs.readFileSync(
    path.join(
      repoRoot,
      "apps/web/src/lib/adminCancelDeliveryRequestRefundCore.ts",
    ),
    "utf8",
  );
  assert.match(src, /dropoff_code_verified_at/);
  assert.match(src, /Force Complete, not Cancel/);
  assert.match(
    src,
    /idempotencyKey: `admin_delivery_cancel_refund_\$\{deliveryRequestId\}`/,
  );
});

test("resolve-stale-job is cancel-only and cron/admin gated", () => {
  const src = fs.readFileSync(
    path.join(
      repoRoot,
      "apps/web/app/api/admin/ops/resolve-stale-job/route.ts",
    ),
    "utf8",
  );
  assert.match(src, /isAuthorizedCronRequest/);
  assert.match(src, /assertCanManageOrders/);
  assert.match(src, /action !== "cancel"/);
  assert.match(src, /stale_job_cancel/);
  assert.match(src, /adminCancelOrderRefundCore/);
  assert.match(src, /adminCancelDeliveryRequestRefundCore/);
});

test("py_ + ch_ source charge still accepted for SCT", () => {
  const src = fs.readFileSync(
    path.join(
      repoRoot,
      "apps/web/src/lib/finance/executeTaxiDriverFareTransfer.ts",
    ),
    "utf8",
  );
  assert.match(src, /startsWith\("ch_"\) \|\| id\.startsWith\("py_"\)/);
});

console.log("admin cancel + stale resolve regression passed");
