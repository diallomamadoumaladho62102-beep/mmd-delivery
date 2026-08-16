import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildOrderTransferIdempotencyKey,
  orderTransferGroup,
} from "./orderTransferGuards";
import { isDeliveryOrderAwaitingTransfer } from "./deliveryWalletSoT";

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

test("wallet awaiting uses driver_transfer_id SoT for orders", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/driverWalletService.ts"),
    "utf8",
  );
  assert.match(src, /\.is\("driver_transfer_id", null\)/);
  assert.match(src, /Never treat driver_paid_out/);
  assert.doesNotMatch(
    src,
    /\.eq\("driver_paid_out", false\)\s*\n\s*\.is\("driver_payout_id", null\)/,
  );
});

test("delivery wallet SoT helper gates on transfer id", () => {
  assert.equal(
    isDeliveryOrderAwaitingTransfer({
      status: "delivered",
      payment_status: "paid",
      driver_transfer_id: null,
    }),
    true,
  );
  assert.equal(
    isDeliveryOrderAwaitingTransfer({
      status: "delivered",
      payment_status: "paid",
      driver_transfer_id: "tr_123",
    }),
    false,
  );
  assert.equal(
    isDeliveryOrderAwaitingTransfer({
      status: "delivered",
      payment_status: "paid",
      refund_status: "refunded",
      driver_transfer_id: null,
    }),
    false,
  );
});

test("order transfer idempotency changes after reverse", () => {
  const base = buildOrderTransferIdempotencyKey("ord-1", "driver");
  const after = buildOrderTransferIdempotencyKey("ord-1", "driver", "tr_rev");
  assert.equal(base, "transfer:ord-1:driver");
  assert.equal(after, "transfer:ord-1:driver:after:tr_rev");
  assert.equal(orderTransferGroup("ord-1"), "ORDER_ord-1");
});

test("transfers/run refuses reversed transfers and reopens failed payouts", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "app/api/stripe/transfers/run/route.ts"),
    "utf8",
  );
  assert.match(src, /isStripeTransferReversed/);
  assert.match(src, /clearReversedOrderTransfer/);
  assert.match(src, /refused reversed transfer/);
  assert.match(src, /Re-open failed payout after reverse/);
  assert.match(src, /buildOrderTransferIdempotencyKey/);
});

test("webhook clears orders transfer ids on reverse", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/stripeTransferPayoutWebhook.ts"),
    "utf8",
  );
  assert.match(src, /orders driver reverse failed/);
  assert.match(src, /driver_transfer_id: null/);
  assert.match(src, /restaurant_transfer_id: null/);
});

test("package cancel allows paid_pending full refund", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "app/api/delivery-requests/cancel/route.ts"),
    "utf8",
  );
  assert.match(src, /clientCanCancelWithFullRefund/);
  assert.match(src, /paid_pending/);
  assert.match(src, /processing_pending/);
});

test("food and package rating APIs exist with ownership gates", () => {
  const food = fs.readFileSync(
    path.join(webRoot, "app/api/orders/[orderId]/rating/route.ts"),
    "utf8",
  );
  const pack = fs.readFileSync(
    path.join(webRoot, "app/api/delivery-requests/[id]/rating/route.ts"),
    "utf8",
  );
  assert.match(food, /upsertDeliveryDriverRating/);
  assert.match(food, /order_ratings/);
  assert.match(food, /rating_must_be_1_to_5/);
  assert.match(pack, /upsertDeliveryDriverRating/);
  assert.match(pack, /not_delivered/);
  assert.match(pack, /rating_already_exists/);
});

test("delivery rating migration dual-writes driver_ratings without deleting food notes", () => {
  const mig = fs.readFileSync(
    path.join(
      repoRoot,
      "supabase/migrations/20261117120000_delivery_rating_driver_dual_write.sql",
    ),
    "utf8",
  );
  assert.match(mig, /driver_ratings/);
  assert.match(mig, /order_ratings/);
  assert.doesNotMatch(mig, /\bdelete from public\.driver_ratings\b/i);
  assert.doesNotMatch(mig, /\bdelete from public\.order_ratings\b/i);
});

console.log("deliveryFinanceWalletRating.regression passed");