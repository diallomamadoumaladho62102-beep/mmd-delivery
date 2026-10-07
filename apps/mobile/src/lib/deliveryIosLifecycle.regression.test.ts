/**
 * iOS Delivery lifecycle vs the production backend contract.
 * Source-scan gates: offer → accept → dispatched → pickup → completion.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function read(rel: string) {
  return fs.readFileSync(path.join(here, rel), "utf8");
}

const home = read("../screens/DriverHomeScreen.tsx");
const details = read("../screens/DriverOrderDetailsScreen.tsx");
const clientDetails = read("../screens/ClientDeliveryRequestDetailsScreen.tsx");
const api = read("./deliveryRequestDriverApi.ts");
const offerApi = read("./driverOrderDriverApi.ts");
const errors = read("./userFacingError.ts");
const missionPush = read("./driverMissionPush.ts");
const commPush = read("./communicationPushRouting.ts");
const stageApi = read("./deliveryStageApi.ts");
const extrasEn = read("../i18n/locales/en/extras.json");
const extrasFr = read("../i18n/locales/fr/extras.json");

test("1-2 offer received and displayed with offer_id, not delivery_request_id as the accept id", () => {
  assert.match(home, /delivery_request_driver_offers/);
  assert.match(home, /offer_id: offer\?\.id/);
  assert.match(home, /pickup_address/);
  assert.match(home, /dropoff_address/);
  assert.match(home, /distance_miles/);
  assert.match(home, /driver_delivery_payout/);
  assert.match(home, /offer_expires_at/);
  assert.doesNotMatch(home, /deliveryAvailableList/);
});

test("3 accept always sends offer_id for package", () => {
  assert.match(home, /acceptDeliveryRequestOffer\(offer\.offer_id\)/);
  assert.match(details, /acceptDeliveryRequestOffer/);
  assert.match(offerApi, /\/api\/delivery-requests\/offers\/accept/);
  assert.match(offerApi, /\{\s*offer_id:\s*offerId\s*\}/);
  assert.doesNotMatch(home, /acceptDeliveryRequest\(orderId\)/);
  assert.doesNotMatch(details, /acceptDeliveryRequest\(order\.id\)/);
  assert.match(api, /if \(!offer\)/);
});

test("4 decline uses the current offer RPC", () => {
  assert.match(home, /driver_reject_delivery_request_offer/);
  assert.match(home, /p_offer_id: offer\.offer_id/);
});

test("5-6 expired and superseded offers leave the available list", () => {
  assert.match(home, /\.gt\("expires_at", nowIso\)/);
  assert.match(home, /remainingOfferSeconds/);
  assert.match(home, /isOrderVisibleForDriver/);
  assert.match(home, /status === "expired"/);
});

test("7 accept 409 / offer_required is mapped for the driver", () => {
  assert.match(errors, /case "offer_required"/);
  assert.match(errors, /case "offer_expired"/);
  assert.match(errors, /case "offer_superseded"/);
  assert.match(details, /toUserFacingError/);
  assert.match(home, /toUserFacingError/);
});

test("8 driver cancel after accept uses driver-cancel then refreshes", () => {
  assert.match(details, /cancelDeliveryRequestAsDriver/);
  assert.match(api, /\/api\/delivery-requests\/driver-cancel/);
  assert.match(details, /order\.status === "dispatched"/);
  assert.match(details, /await fetchOrder\(\)/);
});

test("9-10 food and package pickup hit the correct APIs and only after dispatched", () => {
  assert.match(details, /\/api\/orders\/pickup-confirm/);
  assert.match(details, /confirmDeliveryRequestPickup/);
  assert.match(api, /\/api\/delivery-requests\/pickup-confirm/);
  assert.match(details, /orderStatus === "dispatched"/);
  assert.doesNotMatch(
    details,
    /\["ready", "accepted", "prepared", "dispatched"\]\.includes\(orderStatus\)/,
  );
  assert.doesNotMatch(details, /driver_id: myUserId/);
});

test("11 completion uses delivered-confirm and cannot double-submit", () => {
  assert.match(api, /\/api\/delivery-requests\/delivered-confirm/);
  assert.match(details, /confirmDeliveryRequestDelivered/);
  assert.match(details, /if \(submittingCode \|\| codeSuccess\) return/);
  assert.match(details, /orderStatus === "picked_up"/);
});

test("12 cancellation: package client cancel includes dispatched and uses the request API", () => {
  assert.match(clientDetails, /status === "dispatched"/);
  assert.match(clientDetails, /cancelDeliveryRequestAsClient/);
  assert.match(clientDetails, /isPackageRequest && data\.requestId/);
});

test("13-15 refresh after background, notification, and app restart", () => {
  assert.match(home, /AppState\.addEventListener\("change"/);
  assert.match(details, /AppState\.addEventListener\("change"/);
  assert.match(details, /subscribePostgresChannel/);
  assert.match(details, /useFocusEffect/);
  assert.match(home, /useFocusEffect/);
  assert.match(commPush, /pickup_confirmed/);
  assert.match(commPush, /delivery_completed/);
  assert.match(missionPush, /offer_id: payload\.offerId/);
  assert.match(details, /delivery_request_driver_offers/);
  assert.match(details, /driver_order_offers/);
});

test("16 duplicate accept is locked by accepting state", () => {
  assert.match(home, /if \(acceptingLockRef\.current\) return/);
  assert.match(home, /setAcceptingId\(offerKey\)/);
  assert.match(details, /if \(!order \|\| !myUserId \|\| accepting\) return/);
  assert.match(details, /!accepting/);
});

test("17-21 driver stage buttons use existing APIs, one action at a time", () => {
  assert.match(stageApi, /\/api\/delivery\/arrive-pickup/);
  assert.match(details, /confirmDeliveryPickupArrival/);
  assert.match(details, /driverArrivedWaitTimer/);
  assert.match(details, /deliveryStage === "arrive_pickup"/);
  assert.match(details, /deliveryStage === "arrive_dropoff"/);
  assert.match(details, /stageLockRef\.current/);
  assert.doesNotMatch(details, /status: "in_transit"/);
  assert.doesNotMatch(details, /status: "driver_arrived_pickup"/);
});

test("22-25 notifications, languages, AppState, network, and deep links", () => {
  assert.match(commPush, /driver_arrived_pickup/);
  assert.match(commPush, /ClientOrderDetails/);
  assert.match(details, /network\.quality/);
  assert.match(extrasEn, /"I've arrived at the restaurant"/);
  assert.match(extrasFr, /"Je suis arrivé au restaurant"/);
  assert.doesNotMatch(extrasFr, /Je suis arrivé — Your driver/);
  assert.match(errors, /case "already_arrived"/);
});

function test(name: string, fn: () => void) {
  fn();
  void name;
}

console.log("deliveryIosLifecycle.regression.test.ts OK");
