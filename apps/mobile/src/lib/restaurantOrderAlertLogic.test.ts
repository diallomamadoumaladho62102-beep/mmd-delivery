import assert from "node:assert/strict";
import {
  isPaidPendingFoodOrder,
  planRestaurantOrderAlert,
  remainingAcceptSeconds,
  restaurantNewOrderDedupKey,
} from "./restaurantOrderAlertLogic";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

const now = Date.parse("2026-07-19T12:00:00.000Z");

test("pending paid food order within accept window is alertable", () => {
  assert.equal(
    isPaidPendingFoodOrder(
      {
        id: "o1",
        status: "pending",
        payment_status: "paid",
        kind: "food",
        created_at: "2026-07-19T11:55:00.000Z",
        restaurant_accept_expires_at: "2026-07-19T12:05:00.000Z",
      },
      now,
    ),
    true,
  );
});

test("non-pending or unpaid orders are not alertable", () => {
  assert.equal(
    isPaidPendingFoodOrder(
      {
        id: "o2",
        status: "accepted",
        payment_status: "paid",
        kind: "food",
        created_at: "2026-07-19T11:55:00.000Z",
      },
      now,
    ),
    false,
  );
  assert.equal(
    isPaidPendingFoodOrder(
      {
        id: "o3",
        status: "pending",
        payment_status: "processing",
        kind: "food",
        created_at: "2026-07-19T11:55:00.000Z",
      },
      now,
    ),
    false,
  );
});

test("plan rings on Restaurant page and other pages the same (screen-agnostic)", () => {
  const order = {
    id: "3705c677-7fad-498c-b312-14035321ee2f",
    status: "pending",
    payment_status: "paid",
    kind: "food",
    created_at: "2026-07-19T11:55:00.000Z",
    restaurant_accept_expires_at: "2026-07-19T12:10:00.000Z",
  };

  const onRestaurantPage = planRestaurantOrderAlert({
    orders: [order],
    announcedOrderIds: [],
    nowMs: now,
  });
  const onOtherPage = planRestaurantOrderAlert({
    orders: [order],
    announcedOrderIds: [],
    nowMs: now,
  });

  assert.equal(onRestaurantPage.shouldRing, true);
  assert.equal(onOtherPage.shouldRing, true);
  assert.deepEqual(onRestaurantPage.newlyAnnouncedIds, [order.id]);
  assert.deepEqual(onOtherPage.newlyAnnouncedIds, [order.id]);
});

test("idempotent: same order_id is not re-announced (no double ring)", () => {
  const orderId = "3705c677-7fad-498c-b312-14035321ee2f";
  const order = {
    id: orderId,
    status: "pending",
    payment_status: "paid",
    kind: "food",
    created_at: "2026-07-19T11:55:00.000Z",
    restaurant_accept_expires_at: "2026-07-19T12:10:00.000Z",
  };

  const first = planRestaurantOrderAlert({
    orders: [order],
    announcedOrderIds: [],
    nowMs: now,
  });
  assert.deepEqual(first.newlyAnnouncedIds, [orderId]);
  assert.equal(first.shouldRing, true);

  const second = planRestaurantOrderAlert({
    orders: [order],
    announcedOrderIds: first.newlyAnnouncedIds,
    nowMs: now,
  });
  assert.deepEqual(second.newlyAnnouncedIds, []);
  assert.equal(second.shouldRing, true);
});

test("expired accept window stops ringing", () => {
  const plan = planRestaurantOrderAlert({
    orders: [
      {
        id: "old",
        status: "pending",
        payment_status: "paid",
        kind: "food",
        created_at: "2026-07-19T10:00:00.000Z",
        restaurant_accept_expires_at: "2026-07-19T10:10:00.000Z",
      },
    ],
    announcedOrderIds: [],
    nowMs: now,
  });
  assert.equal(plan.shouldRing, false);
  assert.equal(remainingAcceptSeconds("2026-07-19T10:10:00.000Z", null, now), 0);
});

test("dedup key is stable by order_id", () => {
  assert.equal(
    restaurantNewOrderDedupKey("3705c677-7fad-498c-b312-14035321ee2f"),
    "restaurant_new_order:3705c677-7fad-498c-b312-14035321ee2f",
  );
});

console.log("restaurantOrderAlertLogic.test.ts: all passed");
