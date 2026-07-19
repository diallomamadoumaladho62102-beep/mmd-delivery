import assert from "node:assert/strict";
import { restaurantNewOrderDedupKey } from "./restaurantPushNotifications";
import {
  MMD_PUSH_SOUNDS,
  RESTAURANT_ORDERS_PUSH_CHANNEL,
  normalizePushPlatform,
  resolvePushSoundForPlatform,
} from "./mmdPushSounds";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("push dedup key is unique per order_id (single push generation)", () => {
  const a = restaurantNewOrderDedupKey("3705c677-7fad-498c-b312-14035321ee2f");
  const b = restaurantNewOrderDedupKey("3705c677-7fad-498c-b312-14035321ee2f");
  const c = restaurantNewOrderDedupKey("other-order");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a, "restaurant_new_order:3705c677-7fad-498c-b312-14035321ee2f");
});

test("Android restaurant channel id is configured", () => {
  assert.equal(RESTAURANT_ORDERS_PUSH_CHANNEL, "restaurant-orders");
});

test("iOS platform strings like 'iOS 26.2.1' map to iOS short sound", () => {
  assert.equal(normalizePushPlatform("iOS 26.2.1"), "ios");
  assert.equal(normalizePushPlatform("ios"), "ios");
  assert.equal(normalizePushPlatform("android"), "android");
  assert.equal(
    resolvePushSoundForPlatform("restaurant_new_order", "iOS 26.4"),
    MMD_PUSH_SOUNDS.orderAccepted,
  );
  assert.equal(
    resolvePushSoundForPlatform("restaurant_new_order", "android"),
    MMD_PUSH_SOUNDS.restaurantRing,
  );
});

console.log("restaurantPushNotifications.test.ts: all passed");
