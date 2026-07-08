import assert from "node:assert/strict";
import {
  extractDriverMissionPushPayload,
  isDriverMissionPushType,
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
  });
  assert.equal(payload.type, "driver_offer");
  assert.equal(payload.orderId, "order-123");
}

testMissionTypes();
testPayloadExtraction();

console.log("driverMissionPush.test.ts OK");
