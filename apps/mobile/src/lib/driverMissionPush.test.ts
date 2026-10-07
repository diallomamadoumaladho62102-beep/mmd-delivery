import assert from "node:assert/strict";
import {
  extractDriverMissionPushPayload,
  isDriverMissionPushType,
  navigateToDriverMission,
} from "./driverMissionPush";

function testMissionTypes() {
  assert.equal(isDriverMissionPushType("taxi_offer_dispatch"), true);
  assert.equal(isDriverMissionPushType("driver_offer"), true);
  assert.equal(isDriverMissionPushType("delivery_request_dispatch"), true);
  assert.equal(isDriverMissionPushType("chat"), false);
}

function testPayloadExtraction() {
  const payload = extractDriverMissionPushPayload({
    type: "driver_offer",
    order_id: "order-123",
    offer_id: "offer-9",
  });
  assert.equal(payload.type, "driver_offer");
  assert.equal(payload.orderId, "order-123");
  assert.equal(payload.offerId, "offer-9");
}

function testPackageDispatchKeepsOfferIdSeparateFromRequestId() {
  const payload = extractDriverMissionPushPayload({
    type: "delivery_request_dispatch",
    delivery_request_id: "req-1",
    offer_id: "offer-2",
  });
  assert.equal(payload.deliveryRequestId, "req-1");
  assert.equal(payload.offerId, "offer-2");

  const navigations: Array<{ name: string; params?: Record<string, unknown> }> =
    [];
  navigateToDriverMission(
    {
      navigate: (name, params) => {
        navigations.push({ name, params });
      },
    },
    payload,
  );
  assert.equal(navigations[0]?.name, "DriverOrderDetails");
  assert.equal(navigations[0]?.params?.orderId, "req-1");
  assert.equal(navigations[0]?.params?.sourceTable, "delivery_requests");
  assert.equal(navigations[0]?.params?.offer_id, "offer-2");
}

function testTaxiOfferOpensRideDetails() {
  const navigations: Array<{ name: string; params?: Record<string, unknown> }> =
    [];
  navigateToDriverMission(
    {
      navigate: (name, params) => {
        navigations.push({ name, params });
      },
    },
    extractDriverMissionPushPayload({
      type: "taxi_offer_dispatch",
      taxi_ride_id: "ride-9",
      offer_id: "offer-9",
    }),
  );
  assert.equal(navigations[0]?.name, "DriverOrderDetails");
  assert.equal(navigations[0]?.params?.orderId, "ride-9");
  assert.equal(navigations[0]?.params?.sourceTable, "taxi_rides");
  assert.equal(navigations[0]?.params?.offer_id, "offer-9");
}

testMissionTypes();
testPayloadExtraction();
testPackageDispatchKeepsOfferIdSeparateFromRequestId();
testTaxiOfferOpensRideDetails();

console.log("driverMissionPush.test.ts OK");
