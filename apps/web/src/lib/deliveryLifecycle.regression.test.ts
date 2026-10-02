import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canTransferMinimumPayAdjustments, parseMinimumPayMode } from "./minimumPay/engineGate";

const web = process.cwd();
const read = (rel: string) => readFileSync(join(web, rel), "utf8");

const restaurant = read("src/lib/restaurantOrderStatusService.ts");
const dispatch = read("app/api/dispatch/smart/route.ts");
const acceptOffer = read("../../supabase/migrations/20261207140000_delivery_system_hardening.sql");
const cancel = read("app/api/orders/cancel/route.ts");
const fee = read("src/lib/pricingEngine/engine/compute/deliveryFeeV1.ts");
const transfers = read("app/api/stripe/transfers/run/route.ts");
const refund = read("src/lib/stripeWebhookChargeRefunded.ts");
const webhook = read("app/api/stripe/webhook/route.ts");
const tip = read("src/lib/finance/executeDriverTipTransfer.ts");
const cashout = read("src/lib/finance/manualCashoutService.ts");
const scan = read("src/lib/driverIntegrity/scan.ts");
const marketplace = read("src/lib/marketplaceDriverJobsService.ts");

test("food: restaurant READY is the only dispatch gate", () => {
  assert.match(restaurant, /nextStatus === "ready"/);
  assert.match(dispatch, /kind === "food" && status === "ready"/);
  assert.match(acceptOffer, /order_not_ready/);
  assert.match(acceptOffer, /lower\(status\) = 'ready'/);
});

test("one active driver: FOR UPDATE + driver_id is null + exclusions", () => {
  assert.match(acceptOffer, /for update/);
  assert.match(acceptOffer, /and driver_id is null/);
  assert.match(acceptOffer, /driver_excluded/);
  assert.match(marketplace, /driver_excluded/);
});

test("pickup cannot happen while restaurant-ready", () => {
  assert.match(acceptOffer, /lower\(coalesce\(status, ''\)\) = 'dispatched'/);
  assert.doesNotMatch(acceptOffer, /in \('dispatched', 'ready'\)/);
});

test("driver cancel expires stale offers before redispatch", () => {
  const block = cancel.split("DRIVER CANCEL")[1] ?? "";
  assert.match(block, /expirePendingDriverOrderOffers/);
  assert.match(block, /triggerSmartDispatchForOrder/);
});

test("V1 fee file is isolated from integrity and minimum pay", () => {
  assert.doesNotMatch(fee, /driverIntegrity|driver_integrity|minimumPay|minimum_pay/);
  assert.doesNotMatch(scan, /deliveryFeeV1|canTransferMinimumPayAdjustments|transfersEnabled/);
});

test("Minimum Pay off cannot transfer", () => {
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
});

test("money movers use stable idempotency keys", () => {
  assert.match(transfers, /idempotencyKey|idempotency/);
  assert.match(tip, /idempotencyKey/);
  assert.match(cashout, /manual-cashout:/);
  assert.match(refund, /clawback|idempotency|stripe_event/);
  assert.match(webhook, /stripe_event_id/);
});
