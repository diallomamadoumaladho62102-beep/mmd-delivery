import assert from "node:assert/strict";
import { computeDayKpiSnapshot, isPaidFoodOrder } from "./restaurantCommandCenterKpi";

const paidPending = {
  payment_status: "paid",
  status: "pending",
  total: 20,
  client_id: "c1",
};
const paidDelivered = {
  payment_status: "paid",
  status: "delivered",
  total: 30,
  client_id: "c1",
};
const unpaidDelivered = {
  payment_status: "pending",
  status: "delivered",
  total: 99,
  client_id: "c2",
};

assert.equal(isPaidFoodOrder(paidPending), true);
assert.equal(isPaidFoodOrder(unpaidDelivered), false);

const snapshot = computeDayKpiSnapshot({
  todayRows: [paidPending, paidDelivered, unpaidDelivered],
  yesterdayRows: [paidDelivered],
});

assert.equal(snapshot.ordersToday, 2);
assert.equal(snapshot.revenueToday, 30);
assert.equal(snapshot.customersToday, 1);
assert.equal(snapshot.averageBasket, 30);
assert.equal(snapshot.ordersYesterday, 1);
assert.equal(snapshot.revenueYesterday, 30);

const noCompleted = computeDayKpiSnapshot({
  todayRows: [paidPending],
  yesterdayRows: [],
});
assert.equal(noCompleted.averageBasket, null);
assert.equal(noCompleted.ordersToday, 1);
assert.equal(noCompleted.revenueToday, 0);

console.log("restaurantCommandCenterKpi.test: ok");
