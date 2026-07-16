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

test("normalizeSourceTable accepts mobile aliases", () => {
  assert.equal(normalizeSourceTable("orders"), "orders");
  assert.equal(normalizeSourceTable("delivery_requests"), "delivery_requests");
  assert.equal(normalizeSourceTable("taxi_rides"), "taxi_rides");
  assert.equal(normalizeSourceTable("taxi_ride"), "taxi_rides");
  assert.equal(
    normalizeSourceTable("marketplace_delivery_jobs"),
    "marketplace_delivery_jobs",
  );
});

test("getUserIdByRole maps delivery and taxi participants", () => {
  assert.equal(
    getUserIdByRole(
      { id: "1", client_user_id: "client-1", driver_id: "driver-1" },
      "client",
      "delivery_requests",
    ),
    "client-1",
  );
  assert.equal(
    getUserIdByRole(
      { id: "2", client_user_id: "client-2", driver_id: "driver-2" },
      "driver",
      "taxi_rides",
    ),
    "driver-2",
  );
  assert.equal(
    getUserIdByRole(
      { id: "3", restaurant_id: "rest-1", client_id: "client-3" },
      "restaurant",
      "orders",
    ),
    "rest-1",
  );
});

test("role support excludes restaurant on delivery/taxi", () => {
  assert.equal(isRoleSupportedForSource("restaurant", "orders"), true);
  assert.equal(isRoleSupportedForSource("restaurant", "delivery_requests"), false);
  assert.equal(isRoleSupportedForSource("driver", "taxi_rides"), true);
});

test("parseCreateMaskedCallBody validates sourceTable from mobile payload", () => {
  const parsed = parseCreateMaskedCallBody({
    orderId: "11111111-1111-4111-8111-111111111111",
    callerRole: "driver",
    targetRole: "client",
    sourceTable: "delivery_requests",
  });

  assert.ok(!("error" in parsed));
  if ("error" in parsed) return;

  assert.equal(parsed.sourceTable, "delivery_requests");
  assert.equal(parsed.callerRole, "driver");
});

test("buildParticipantRpc selects RPC per source table", () => {
  assert.deepEqual(buildParticipantRpc("orders", "abc"), {
    fn: "order_participant_ids",
    args: { p_order_id: "abc" },
  });
  assert.deepEqual(buildParticipantRpc("taxi_rides", "xyz"), {
    fn: "taxi_ride_participant_ids",
    args: { p_ride_id: "xyz" },
  });
});

test("getResourceLabel returns readable labels", () => {
  assert.equal(getResourceLabel("delivery_requests"), "Delivery request");
  assert.equal(getResourceLabel("taxi_rides"), "Taxi ride");
});
