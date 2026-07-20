import assert from "node:assert/strict";
import {
  DELIVERY_COMPLETED_CLIENT_EVENT,
  DELIVERY_COMPLETED_DRIVER_EVENT,
  deliveryCompletionDedupKey,
} from "@/lib/deliveryCompletionNotifications";

const dr = "1db1f655-3a46-4de5-8a5a-683d65f6fca7";

assert.equal(
  deliveryCompletionDedupKey(dr, DELIVERY_COMPLETED_CLIENT_EVENT),
  `delivery_request_delivered_client:${dr}`,
);
assert.equal(
  deliveryCompletionDedupKey(dr, DELIVERY_COMPLETED_DRIVER_EVENT),
  `delivery_request_delivered_driver:${dr}`,
);

assert.equal(
  deliveryCompletionDedupKey("  abc  ", " delivery_request_delivered_client "),
  deliveryCompletionDedupKey("abc", "delivery_request_delivered_client"),
);

console.log("deliveryCompletionNotifications tests passed");
