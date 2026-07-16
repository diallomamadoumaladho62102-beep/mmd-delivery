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
  assert.equal(isCommunicationPushType("driver_offer"), false);
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
