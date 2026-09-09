import assert from "node:assert/strict";
import {
  isConfirmedRealPayment,
  isRealMoneyFinancialSource,
  isRealMoneyTrip,
  realMoneyBlockReason,
} from "./realMoneyGuard";
import { computeRestaurantTotalsFromOrders } from "../restaurantTax";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`fail - ${name}`);
    throw e;
  }
}

const restaurantId = "rest-1";

test("TEST 1 — real paid delivered order is real money", () => {
  const row = {
    is_test: false,
    hidden_from_user: false,
    archived_at: null,
    payment_status: "paid",
  };
  assert.equal(isRealMoneyTrip(row), true);
  assert.equal(isConfirmedRealPayment(row), true);
  assert.equal(isRealMoneyFinancialSource(row), true);
  assert.equal(realMoneyBlockReason(row), null);
});

test("TEST 3 — fake/test orders never become real money", () => {
  const fake = {
    is_test: true,
    hidden_from_user: false,
    archived_at: null,
    payment_status: "paid",
    restaurant_id: restaurantId,
    status: "delivered",
    subtotal: 50,
  };
  assert.equal(isRealMoneyFinancialSource(fake), false);
  assert.equal(realMoneyBlockReason(fake), "test_or_demo_excluded");
});

test("TEST 4 — real + fake mix counts only real money", () => {
  const totals = computeRestaurantTotalsFromOrders({
    rows: [
      {
        restaurant_id: restaurantId,
        status: "delivered",
        payment_status: "paid",
        is_test: false,
        subtotal: 40,
      },
      {
        restaurant_id: restaurantId,
        status: "delivered",
        payment_status: "paid",
        is_test: true,
        subtotal: 999,
      },
      {
        restaurant_id: restaurantId,
        status: "delivered",
        payment_status: "unpaid",
        is_test: false,
        subtotal: 80,
      },
    ],
    restaurantUserId: restaurantId,
    year: 2026,
    range: "yearly",
    commissionRate: 0.15,
  });
  assert.equal(totals.totalOrders, 1);
  assert.equal(totals.grossSales, 40);
  assert.equal(totals.platformCommission, 6);
  assert.equal(totals.restaurantNet, 34);
});

test("archived / hidden / unpaid / refunded are excluded", () => {
  assert.equal(
    realMoneyBlockReason({
      is_test: false,
      archived_at: "2026-09-01T00:00:00Z",
      payment_status: "paid",
    }),
    "archived_excluded",
  );
  assert.equal(
    realMoneyBlockReason({
      is_test: false,
      hidden_from_user: true,
      payment_status: "paid",
    }),
    "hidden_from_user_excluded",
  );
  assert.equal(
    realMoneyBlockReason({
      is_test: false,
      payment_status: "pending",
    }),
    "payment_not_confirmed",
  );
  assert.equal(
    realMoneyBlockReason({
      is_test: false,
      payment_status: "paid",
      refund_status: "refunded",
    }),
    "refund_or_dispute_excluded",
  );
  assert.equal(
    realMoneyBlockReason({
      is_test: false,
      payment_status: "paid",
      status: "cancelled",
    }),
    "cancelled_excluded",
  );
});

console.log("realMoneyGuard tests passed");
