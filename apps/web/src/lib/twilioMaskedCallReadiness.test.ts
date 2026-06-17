import assert from "node:assert/strict";
import test from "node:test";
import {
  buildParticipantRpc,
  getResourceLabel,
  getUserIdByRole,
  isRoleSupportedForSource,
  normalizeSourceTable,
  parseCreateMaskedCallBody,
} from "./maskedCallCreate";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";

test("Twilio readiness: food orders support client driver restaurant roles", () => {
  assert.equal(normalizeSourceTable("orders"), "orders");
  assert.equal(isRoleSupportedForSource("client", "orders"), true);
  assert.equal(isRoleSupportedForSource("driver", "orders"), true);
  assert.equal(isRoleSupportedForSource("restaurant", "orders"), true);
  assert.equal(
    getUserIdByRole(
      { id: ORDER_ID, client_id: "c1", driver_id: "d1", restaurant_id: "r1" },
      "restaurant",
      "orders",
    ),
    "r1",
  );
});

test("Twilio readiness: delivery requests support client and driver only", () => {
  const parsed = parseCreateMaskedCallBody({
    orderId: ORDER_ID,
    callerRole: "driver",
    targetRole: "client",
    sourceTable: "delivery_requests",
  });
  assert.ok(!("error" in parsed));
  assert.equal(isRoleSupportedForSource("restaurant", "delivery_requests"), false);
  assert.equal(buildParticipantRpc("delivery_requests", ORDER_ID).fn, "delivery_request_participant_ids");
});

test("Twilio readiness: taxi rides support client and driver only", () => {
  const parsed = parseCreateMaskedCallBody({
    orderId: ORDER_ID,
    callerRole: "client",
    targetRole: "driver",
    sourceTable: "taxi_rides",
  });
  assert.ok(!("error" in parsed));
  assert.equal(getResourceLabel("taxi_rides"), "Taxi ride");
  assert.equal(isRoleSupportedForSource("driver", "taxi_rides"), true);
});
