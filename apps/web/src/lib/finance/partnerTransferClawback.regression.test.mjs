/**
 * Regression: refund / clawback after SCT (food, taxi, package, tips).
 * Source-level invariants — no live Stripe.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const root = join(import.meta.dirname, "../../../../../");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

function ok(name) {
  console.log(`ok ${name}`);
}

{
  const src = read("apps/web/src/lib/stripeWebhookChargeRefunded.ts");
  assert.match(src, /clawbackPartnerTransfersForRefund/);
  assert.match(src, /clawbackTipTransfersForRefund/);
  assert.match(src, /Always re-run clawback/);
  assert.match(src, /runPartnerClawbackForTable/);
  assert.match(src, /reversePaidMarketplaceTransfers/);
  ok("charge.refunded claws back food/taxi/package + tip paths");
}

{
  const src = read("apps/web/src/lib/finance/partnerTransferClawback.ts");
  assert.match(src, /transfers\.createReversal/);
  assert.match(src, /recovery_required/);
  assert.match(src, /partner_transfer_recoveries/);
  assert.match(src, /isBenignTransferReversalError/);
  assert.match(src, /cancelOpenFoodOrderPayouts/);
  assert.match(src, /must not claw tip/);
  assert.match(src, /clawbackTipTransfersForRefund/);
  assert.match(src, /partnerClawbackIdempotencyKey/);
  assert.match(src, /recordFailedTransferRecovery/);
  assert.match(src, /Never writes status `recovered`/);
  assert.match(src, /Idempotent short-circuit/);
  assert.doesNotMatch(src, /status: "recovered"/);
  assert.match(
    read("apps/web/src/lib/finance/partnerTransferClawbackGuards.ts"),
    /partner_rev/
  );
  ok("shared clawback createReversal + recovery_required (never auto recovered)");
}

{
  const src = read("apps/web/app/api/stripe/transfers/run/route.ts");
  assert.match(src, /Order refunded or disputed — transfer blocked/);
  assert.match(src, /isBlockedRefundStatus/);
  ok("transfers/run blocks refunded orders");
}

{
  const src = read("apps/web/src/lib/taxiPayoutEligibility.ts");
  assert.match(src, /refunded/);
  assert.match(src, /partially_refunded/);
  assert.match(src, /disputed/);
  ok("taxi eligibility blocks refunded rides");
}

{
  const src = read("apps/web/app/api/admin/taxi-rides/cancel-refund/route.ts");
  assert.doesNotMatch(src, /taxi_refund_not_allowed_after_payout/);
  assert.match(src, /clawbackPartnerTransfersForRefund/);
  assert.match(src, /reconcile_required/);
  ok("admin taxi cancel-refund allows post-SCT clawback");
}

{
  const src = read("apps/web/src/lib/stripeWebhookDispute.ts");
  assert.match(src, /reverseStripeTransferOrRecover/);
  assert.match(src, /tip_transfer_id/);
  assert.match(src, /delivery_request/);
  assert.match(src, /recovery_required/);
  ok("dispute clawback uses shared helper + tip/package refs");
}

{
  const src = read("apps/web/src/lib/marketplaceRefundService.ts");
  assert.match(src, /transfers\.createReversal/);
  assert.match(src, /mkt_refund_rev_/);
  assert.match(src, /recordFailedTransferRecovery/);
  ok("marketplace createReversal retained + failed recovery recorded");
}

{
  const sql = read(
    "supabase/migrations/20261204120000_partner_transfer_recoveries.sql"
  );
  assert.match(sql, /partner_transfer_recoveries/);
  assert.match(sql, /recovery_required/);
  assert.match(sql, /'recovered'/);
  assert.match(sql, /idempotency_key/);
  assert.match(sql, /partner_transfer_recoveries_idempotency_uq/);
  assert.match(sql, /NEVER set by automatic clawback/);
  ok("migration partner_transfer_recoveries statuses");
}

{
  // Scenario matrix coverage (source contracts).
  const claw = read("apps/web/src/lib/finance/partnerTransferClawback.ts");
  const refund = read("apps/web/src/lib/stripeWebhookChargeRefunded.ts");
  const transfers = read("apps/web/app/api/stripe/transfers/run/route.ts");
  assert.match(transfers, /Order refunded or disputed — transfer blocked/);
  assert.match(claw, /cancelOpenFoodOrderPayouts/);
  assert.match(claw, /createReversal/);
  assert.match(claw, /recovery_required/);
  assert.match(claw, /balance_insufficient|transfer_reversal_failed|Insufficient/);
  assert.match(refund, /Always re-run clawback/);
  assert.match(refund, /clawbackTipTransfersForRefund/);
  assert.match(claw, /delivery_request/);
  assert.match(claw, /taxi_ride/);
  assert.match(claw, /food_order/);
  ok("scenario matrix A–N source contracts");
}

{
  const src = read("apps/web/src/lib/stripeTransferPayoutWebhook.ts");
  assert.match(src, /transfer\.reversed/);
  assert.match(src, /driver_transfer_id: null/);
  assert.match(src, /restaurant_transfer_id: null/);
  assert.match(src, /tip_transfer_id: null/);
  ok("transfer.reversed clears local paid flags");
}

console.log("partnerTransferClawback regression passed");
