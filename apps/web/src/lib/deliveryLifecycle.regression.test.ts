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
const acceptDirect = read("app/api/delivery-requests/accept/route.ts");
const drCancel = read("app/api/delivery-requests/cancel/route.ts");
const drDriverCancel = read("app/api/delivery-requests/driver-cancel/route.ts");
const drDispatch = read("src/lib/runDeliveryRequestDispatch.ts");
const mpTripIsolation = read(
  "../../supabase/migrations/20261209120000_delivery_accept_hardening.sql"
);

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
  assert.match(block, /status === "dispatched"/);
});

test("package accept cannot snipe without a pending offer", () => {
  assert.match(acceptDirect, /offer_required/);
  assert.match(acceptDirect, /driver_accept_delivery_request_offer/);
  assert.match(acceptDirect, /getOptionalDeliveryRequestOfferId/);
  assert.doesNotMatch(acceptDirect, /driver_accept_delivery_request"/);
  assert.match(mpTripIsolation, /message', 'offer_required'/);
  assert.match(mpTripIsolation, /driver_accept_delivery_request_offer/);
});

test("package mirror order lookup is idempotent and survives duplicate rows", () => {
  const driver = read("src/lib/deliveryRequestDriver.ts");
  const ensure = read("src/lib/finance/ensurePackageDriverSctOrder.ts");
  const sync = read("src/lib/deliveryRequestService.ts");
  assert.match(driver, /findLinkedPackageMirrorOrder/);
  assert.match(driver, /order\("created_at", \{ ascending: true \}\)/);
  assert.match(driver, /\.limit\(1\)/);
  assert.match(ensure, /findLinkedPackageMirrorOrder/);
  assert.match(ensure, /raced/);
  assert.match(sync, /findLinkedPackageMirrorOrder/);
  assert.match(sync, /raced/);
});

test("package pickup notifies the client once", () => {
  const pickup = read("app/api/delivery-requests/pickup-confirm/route.ts");
  const push = read("src/lib/clientPushNotifications.ts");
  assert.match(pickup, /notifyClientDeliveryRequestPickedUp/);
  assert.match(push, /deliveryRequestPickupDedupKey/);
  assert.match(push, /pickup_confirmed/);
});

test("client can cancel a dispatched package request and does not double-refund the same PI", () => {
  assert.match(drCancel, /status === "accepted" \|\| status === "dispatched"/);
  assert.match(drCancel, /samePaymentIntent/);
});

test("package driver release expires offers and redispatches immediately", () => {
  assert.match(drDriverCancel, /expirePendingDeliveryRequestOffers/);
  assert.match(drDriverCancel, /triggerDeliveryRequestDispatch/);
});

test("dispatch skips test and archived trips", () => {
  assert.match(drDispatch, /isLiveVisibleTrip/);
  assert.match(dispatch, /isLiveVisibleTrip/);
  assert.match(dispatch, /test_or_archived_order/);
});

test("package mirror orders do not create a second Minimum Pay trip interval", () => {
  assert.match(mpTripIsolation, /external_ref_type, ''\) = 'delivery_request'/);
  const compute = read("src/lib/minimumPay/computeStandardMinimumPay.ts");
  assert.match(compute, /weight: row\.onCallSeconds > 0 \? row\.onCallSeconds : row\.tripSeconds/);
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
