import assert from "node:assert/strict";
import test from "node:test";
import { computeDeliveryFeeV1 } from "./pricingEngine/engine/compute/deliveryFeeV1";
import {
  canTransferMinimumPayAdjustments,
  parseMinimumPayMode,
} from "./minimumPay/engineGate";
import { executeNycMprAdjustmentTransfer } from "./minimumPay/executeNycMprAdjustmentTransfer";
import {
  buildOrderTransferIdempotencyKey,
  orderTransferGroup,
} from "./finance/orderTransferGuards";
import {
  buildDriverTipTransferIdempotencyKey,
  buildDriverTipTransferParams,
  driverTipShareCents,
  TIP_MODEL,
} from "./finance/tipMoneyArchitecture";
import { partnerClawbackIdempotencyKey } from "./finance/partnerTransferClawbackGuards";
import {
  isRealMoneyFinancialSource,
  realMoneyBlockReason,
} from "./finance/realMoneyGuard";
import { shouldApplyPaymentFailureUpdate } from "./stripeWebhookPaymentFailure";
import {
  claimPaymentWebhookEvent,
  finalizePaymentWebhookEvent,
} from "./paymentWebhookService";

type DeliveryStatus =
  | "pending"
  | "accepted_by_restaurant"
  | "ready"
  | "dispatched"
  | "picked_up"
  | "delivered"
  | "cancelled";

type DeliveryOrder = {
  id: string;
  status: DeliveryStatus;
  driverId: string | null;
  excluded: Set<string>;
  paymentStatus: "unpaid" | "paid" | "failed" | "refunded";
  refundStatus: string | null;
  stripeSessionId: string | null;
  stripePaymentIntentId: string | null;
  driverTransferId: string | null;
  restaurantTransferId: string | null;
  tipTransferId: string | null;
  payouts: Set<string>;
};

function acceptOffer(order: DeliveryOrder, driverId: string) {
  if (order.excluded.has(driverId)) return { ok: false, message: "driver_excluded" };
  if (order.driverId) return { ok: false, message: "already_assigned" };
  if (order.status !== "ready") return { ok: false, message: "order_not_ready" };
  order.driverId = driverId;
  order.status = "dispatched";
  return { ok: true, message: "accepted" };
}

function pickup(order: DeliveryOrder, driverId: string) {
  if (order.status !== "dispatched") return { ok: false, message: "not_dispatched" };
  if (order.driverId !== driverId) return { ok: false, message: "wrong_driver" };
  order.status = "picked_up";
  return { ok: true };
}

function deliver(order: DeliveryOrder, driverId: string) {
  if (order.status !== "picked_up") return { ok: false, message: "not_picked_up" };
  if (order.driverId !== driverId) return { ok: false, message: "wrong_driver" };
  order.status = "delivered";
  return { ok: true };
}

function reassign(order: DeliveryOrder, nextDriverId: string) {
  if (order.driverId) order.excluded.add(order.driverId);
  order.driverId = null;
  order.status = "ready";
  return acceptOffer(order, nextDriverId);
}

function recordPayout(order: DeliveryOrder, key: string, target: "driver" | "restaurant" | "tip") {
  if (order.payouts.has(key)) return { ok: false, message: "duplicate_payout" };
  if (order.paymentStatus !== "paid") return { ok: false, message: "payment_not_confirmed" };
  if (order.refundStatus) return { ok: false, message: "refunded" };
  order.payouts.add(key);
  if (target === "driver") order.driverTransferId = `tr_${target}_${order.id}`;
  if (target === "restaurant") order.restaurantTransferId = `tr_${target}_${order.id}`;
  if (target === "tip") order.tipTransferId = `tr_${target}_${order.id}`;
  return { ok: true, transferId: `tr_${target}_${order.id}` };
}

test("food delivery sandbox: READY → dispatch → accept → pickup → delivery → earnings", () => {
  const fee = computeDeliveryFeeV1({ distanceMiles: 2.4, durationMinutes: 18 });
  assert.ok(fee.deliveryFee > 0);
  assert.equal(
    Number((fee.platformFee + fee.driverPayout).toFixed(2)),
    fee.deliveryFee
  );

  const order: DeliveryOrder = {
    id: "ord-sandbox-1",
    status: "ready",
    driverId: null,
    excluded: new Set(),
    paymentStatus: "paid",
    refundStatus: null,
    stripeSessionId: "cs_test_1",
    stripePaymentIntentId: "pi_test_1",
    driverTransferId: null,
    restaurantTransferId: null,
    tipTransferId: null,
    payouts: new Set(),
  };

  assert.equal(acceptOffer(order, "d1").ok, true);
  assert.equal(order.status, "dispatched");
  assert.equal(pickup({ ...order, status: "ready" }, "d1").ok, false);
  assert.equal(pickup(order, "d1").ok, true);
  assert.equal(deliver(order, "d1").ok, true);

  const driverKey = buildOrderTransferIdempotencyKey(order.id, "driver");
  const restaurantKey = buildOrderTransferIdempotencyKey(order.id, "restaurant");
  const tipKey = buildDriverTipTransferIdempotencyKey(order.id);
  assert.equal(recordPayout(order, driverKey, "driver").ok, true);
  assert.equal(recordPayout(order, restaurantKey, "restaurant").ok, true);
  assert.equal(recordPayout(order, tipKey, "tip").ok, true);
  assert.equal(recordPayout(order, driverKey, "driver").message, "duplicate_payout");
  assert.equal(orderTransferGroup(order.id), "ORDER_ord-sandbox-1");
  assert.equal(TIP_MODEL.platformShareBps, 0);
  assert.equal(driverTipShareCents(400), 400);
});

test("duplicate acceptance and old driver after reassignment lose", () => {
  const order: DeliveryOrder = {
    id: "ord-race",
    status: "ready",
    driverId: null,
    excluded: new Set(),
    paymentStatus: "paid",
    refundStatus: null,
    stripeSessionId: "cs_test_race",
    stripePaymentIntentId: "pi_test_race",
    driverTransferId: null,
    restaurantTransferId: null,
    tipTransferId: null,
    payouts: new Set(),
  };
  const first = acceptOffer(order, "d-old");
  const second = acceptOffer(order, "d-new");
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.message, "already_assigned");

  const moved = reassign(order, "d-new");
  assert.equal(moved.ok, true);
  assert.equal(order.driverId, "d-new");
  assert.equal(acceptOffer(order, "d-old").message, "driver_excluded");
  assert.equal(pickup(order, "d-old").message, "wrong_driver");
});

test("cancellation and refund block later payouts", () => {
  const order: DeliveryOrder = {
    id: "ord-refund",
    status: "ready",
    driverId: null,
    excluded: new Set(),
    paymentStatus: "paid",
    refundStatus: null,
    stripeSessionId: "cs_test_refund",
    stripePaymentIntentId: "pi_test_refund",
    driverTransferId: null,
    restaurantTransferId: null,
    tipTransferId: null,
    payouts: new Set(),
  };
  acceptOffer(order, "d1");
  order.status = "cancelled";
  order.refundStatus = "refunded";
  order.paymentStatus = "refunded";
  const key = buildOrderTransferIdempotencyKey(order.id, "driver");
  assert.equal(recordPayout(order, key, "driver").ok, false);
  assert.equal(
    isRealMoneyFinancialSource({
      payment_status: "refunded",
      refund_status: "refunded",
      status: "cancelled",
    }),
    false
  );
  assert.equal(
    realMoneyBlockReason({
      payment_status: "refunded",
      refund_status: "refunded",
      status: "cancelled",
    }),
    "cancelled_excluded"
  );
  const clawA = partnerClawbackIdempotencyKey({
    source: "refund",
    entityType: "food_order",
    entityId: order.id,
    transferId: "tr_driver",
    correlationId: "re_1",
  });
  const clawB = partnerClawbackIdempotencyKey({
    source: "refund",
    entityType: "food_order",
    entityId: order.id,
    transferId: "tr_driver",
    correlationId: "re_1",
  });
  assert.equal(clawA, clawB);
});

test("payment failure after paid is ignored; unpaid can fail", () => {
  const paid = shouldApplyPaymentFailureUpdate({
    payment_status: "paid",
    incoming_session_id: "cs_1",
    incoming_payment_intent_id: "pi_1",
  });
  assert.equal(paid.apply, false);
  const unpaid = shouldApplyPaymentFailureUpdate({
    payment_status: "unpaid",
    stripe_session_id: "cs_1",
    incoming_session_id: "cs_1",
    incoming_payment_intent_id: "pi_1",
  });
  assert.equal(unpaid.apply, true);
});

test("tip SCT is 100% driver and isolated from the delivery SCT key", () => {
  const tip = buildDriverTipTransferParams({
    tipCents: 250,
    tipChargeId: "ch_test_tip",
    destinationAccountId: "acct_test_driver",
    currency: "usd",
    orderId: "ord-tip",
  });
  assert.equal(tip.amount, 250);
  assert.equal(tip.source_transaction, "ch_test_tip");
  assert.notEqual(
    buildDriverTipTransferIdempotencyKey("ord-tip"),
    buildOrderTransferIdempotencyKey("ord-tip", "driver")
  );
});

test("Minimum Pay OFF never creates an MPR Stripe transfer", async () => {
  assert.equal(parseMinimumPayMode("off"), "off");
  assert.equal(
    canTransferMinimumPayAdjustments(
      {
        mode: "off",
        engineStartAt: null,
        timezone: "America/New_York",
        periodLengthDays: 7,
        periodStartWeekday: 1,
        defaultJurisdiction: "NYC",
        defaultCurrency: "usd",
        defaultMethod: "hourly",
        defaultRounding: "nearest",
        eligibleCountyCodes: [],
        eligibleSourceTypes: [],
        excludedSourceTypes: [],
        waitFeeCounts: false,
        bonusCounts: false,
        transfersEnabled: false,
        onCallStaleAfterSeconds: null,
        requireChangeReason: true,
      },
      Date.now()
    ),
    false
  );

  let stripeCalled = false;
  const supabase = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({
          data: {
            mode: "off",
            transfers_enabled: false,
            engine_start_at: null,
            singleton: true,
          },
          error: null,
        }),
      };
    },
  };
  const previousStripe = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_dynamic_suite_never_live";
  try {
    const result = await executeNycMprAdjustmentTransfer(supabase as never, {
      adjustmentId: "adj-1",
      driverId: "d1",
      amountCents: 1200,
      currency: "usd",
      idempotencyKey: "mpr-adj-1",
      destinationAccountId: "acct_test",
      metadata: { role: "test" },
    });
    stripeCalled = false;
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.skipped, true);
      assert.equal(result.reason, "transfers_not_enabled");
    }
    assert.equal(stripeCalled, false);
  } finally {
    if (previousStripe === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousStripe;
  }
});

test("webhook claim: retry, duplicate, and concurrent request", async () => {
  const events = new Map<
    string,
    {
      id: string;
      status: string;
      attempt_count: number;
      processing_started_at: string | null;
    }
  >();
  const supabase = {
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "claim_payment_webhook_event") {
        const key = `${args.p_provider}::${args.p_external_event_id}`;
        const existing = events.get(key);
        if (!existing) {
          const row = {
            id: "wh-1",
            status: "processing",
            attempt_count: 1,
            processing_started_at: new Date().toISOString(),
          };
          events.set(key, row);
          return Promise.resolve({
            data: { ok: true, outcome: "claimed", id: row.id, status: row.status },
            error: null,
          });
        }
        if (existing.status === "processed") {
          return Promise.resolve({
            data: { ok: true, outcome: "already_processed", id: existing.id },
            error: null,
          });
        }
        return Promise.resolve({
          data: { ok: true, outcome: "in_progress", id: existing.id },
          error: null,
        });
      }
      if (name === "finalize_payment_webhook_event") {
        for (const row of events.values()) {
          if (row.id === args.p_event_id) {
            row.status = String(args.p_outcome);
          }
        }
        return Promise.resolve({ data: { ok: true }, error: null });
      }
      return Promise.resolve({ data: null, error: { message: "unknown" } });
    },
  };

  const first = await claimPaymentWebhookEvent(supabase as never, {
    provider: "stripe",
    externalEventId: "evt_sandbox_1",
    payload: { id: "evt_sandbox_1" },
  });
  assert.equal(first.outcome, "claimed");
  const concurrent = await claimPaymentWebhookEvent(supabase as never, {
    provider: "stripe",
    externalEventId: "evt_sandbox_1",
    payload: { id: "evt_sandbox_1" },
  });
  assert.equal(concurrent.outcome, "in_progress");
  await finalizePaymentWebhookEvent(supabase as never, {
    eventId: first.id!,
    outcome: "processed",
    paymentTransactionId: "pay-sandbox-1",
  });
  const retry = await claimPaymentWebhookEvent(supabase as never, {
    provider: "stripe",
    externalEventId: "evt_sandbox_1",
    payload: { id: "evt_sandbox_1" },
  });
  assert.equal(retry.outcome, "already_processed");
});
