import assert from "node:assert/strict";
import test from "node:test";

import {
  extractCommunicationPushPayload,
  isCommunicationPushType,
  navigateFromCommunicationPush,
} from "./communicationPushRouting";

test("extractCommunicationPushPayload normalizes order chat push", () => {
  const payload = extractCommunicationPushPayload({
    type: "order_message",
    order_id: "11111111-1111-4111-8111-111111111111",
    target_role: "driver",
    source_table: "marketplace_delivery_jobs",
  });

  assert.equal(payload.type, "order_message");
  assert.equal(payload.order_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(payload.target_role, "driver");
  assert.equal(payload.source_table, "marketplace_delivery_jobs");
});

test("isCommunicationPushType includes order lifecycle pushes", () => {
  assert.equal(isCommunicationPushType("order_paid"), true);
  assert.equal(isCommunicationPushType("order_message"), true);
  assert.equal(isCommunicationPushType("pickup_confirmed"), true);
  assert.equal(isCommunicationPushType("delivery_completed"), true);
  assert.equal(isCommunicationPushType("delivery_request_cancelled"), true);
  assert.equal(isCommunicationPushType("taxi_ride_completed"), true);
  assert.equal(isCommunicationPushType("wait_fee_started"), true);
  assert.equal(isCommunicationPushType("wait_final_warning"), true);
  assert.equal(isCommunicationPushType("driver_offer"), false);
});

test("taxi completion and wait-fee pushes open the matching screen", () => {
  const navigations: Array<{ name: string; params?: Record<string, unknown> }> =
    [];
  const nav = {
    navigate: (name: string, params?: Record<string, unknown>) => {
      navigations.push({ name, params });
    },
  };
  assert.equal(
    navigateFromCommunicationPush(nav, {
      type: "taxi_ride_completed",
      taxi_ride_id: "ride-1",
    }),
    true,
  );
  assert.equal(
    navigateFromCommunicationPush(nav, {
      type: "wait_fee_started",
      entity_type: "delivery_request",
      entity_id: "req-1",
    }),
    true,
  );
  assert.equal(navigations[0]?.name, "TaxiRideTracking");
  assert.equal(navigations[0]?.params?.rideId, "ride-1");
  assert.equal(navigations[1]?.name, "ClientDeliveryRequestDetails");
  assert.equal(navigations[1]?.params?.requestId, "req-1");
});

test("driver_arrived_pickup opens food order details when only order_id is present", () => {
  const navigations: Array<{ name: string; params?: Record<string, unknown> }> =
    [];
  const handled = navigateFromCommunicationPush(
    {
      navigate: (name, params) => {
        navigations.push({ name, params });
      },
    },
    {
      type: "driver_arrived_pickup",
      order_id: "ord-1",
    },
  );
  assert.equal(handled, true);
  assert.equal(navigations[0]?.name, "ClientOrderDetails");
  assert.equal(navigations[0]?.params?.orderId, "ord-1");
});

test("pickup_confirmed opens the client delivery request, not an offer", () => {
  const navigations: Array<{ name: string; params?: Record<string, unknown> }> =
    [];
  const handled = navigateFromCommunicationPush(
    {
      navigate: (name, params) => {
        navigations.push({ name, params });
      },
    },
    {
      type: "pickup_confirmed",
      delivery_request_id: "req-1",
      offer_id: "offer-should-not-be-used-as-request",
    },
  );
  assert.equal(handled, true);
  assert.equal(navigations[0]?.name, "ClientDeliveryRequestDetails");
  assert.equal(navigations[0]?.params?.requestId, "req-1");
});

test("delivery_completed opens driver details when target is driver", () => {
  const navigations: Array<{ name: string; params?: Record<string, unknown> }> =
    [];
  const handled = navigateFromCommunicationPush(
    {
      navigate: (name, params) => {
        navigations.push({ name, params });
      },
    },
    {
      type: "delivery_completed",
      delivery_request_id: "req-2",
      target_role: "driver",
    },
  );
  assert.equal(handled, true);
  assert.equal(navigations[0]?.name, "DriverOrderDetails");
  assert.equal(navigations[0]?.params?.orderId, "req-2");
  assert.equal(navigations[0]?.params?.sourceTable, "delivery_requests");
});

test("navigateFromCommunicationPush opens driver chat for driver target", () => {
  const navigations: Array<{ name: string; params?: Record<string, unknown> }> =
    [];

  const handled = navigateFromCommunicationPush(
    {
      navigate: (name, params) => {
        navigations.push({ name, params });
      },
    },
    {
      type: "order_message",
      orderId: "11111111-1111-4111-8111-111111111111",
      target_role: "driver",
      sourceTable: "orders",
    },
  );

  assert.equal(handled, true);
  assert.equal(navigations[0]?.name, "DriverChat");
  assert.equal(navigations[0]?.params?.orderId, "11111111-1111-4111-8111-111111111111");
});
