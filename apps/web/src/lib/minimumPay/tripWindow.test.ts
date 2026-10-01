import assert from "node:assert/strict";
import test from "node:test";
import { resolveTripWindow, restaurantPrepBeforeAcceptIsExcluded } from "./tripWindow";

test("trip starts at driver acceptance after restaurant READY", () => {
  const window = resolveTripWindow({
    createdAt: "2000-01-01T10:00:00.000Z",
    restaurantAcceptedAt: "2000-01-01T10:05:00.000Z",
    preparingAt: "2000-01-01T10:06:00.000Z",
    readyAt: "2000-01-01T10:20:00.000Z",
    driverAcceptedAt: "2000-01-01T10:22:00.000Z",
  });
  assert.equal(window?.startedAt, "2000-01-01T10:22:00.000Z");
});

test("restaurant preparation before acceptance is excluded from driver trip time", () => {
  const row = {
    createdAt: "2000-01-01T10:00:00.000Z",
    restaurantAcceptedAt: "2000-01-01T10:05:00.000Z",
    preparingAt: "2000-01-01T10:06:00.000Z",
    readyAt: "2000-01-01T10:20:00.000Z",
    driverAcceptedAt: "2000-01-01T10:22:00.000Z",
    deliveredAt: "2000-01-01T10:40:00.000Z",
  };
  assert.equal(restaurantPrepBeforeAcceptIsExcluded(row), true);
  const window = resolveTripWindow(row);
  assert.ok(window);
  assert.equal(Date.parse(window.startedAt) > Date.parse(row.readyAt), true);
});

test("restaurant waiting after acceptance is recorded as trip time", () => {
  const window = resolveTripWindow({
    driverAcceptedAt: "2000-01-01T10:22:00.000Z",
    deliveredAt: "2000-01-01T10:50:00.000Z",
  });
  assert.equal(window?.endReason, "completed");
  assert.equal(
    Date.parse(window?.endedAt ?? "") - Date.parse(window?.startedAt ?? ""),
    28 * 60_000
  );
});

test("no driver acceptance means no trip window", () => {
  assert.equal(
    resolveTripWindow({
      restaurantAcceptedAt: "2000-01-01T10:05:00.000Z",
      driverAcceptedAt: null,
    }),
    null
  );
});

test("cancelled trip ends at cancelled_at", () => {
  const window = resolveTripWindow({
    driverAcceptedAt: "2000-01-01T10:22:00.000Z",
    cancelledAt: "2000-01-01T10:30:00.000Z",
    status: "cancelled",
  });
  assert.equal(window?.endReason, "cancelled");
  assert.equal(window?.endedAt, "2000-01-01T10:30:00.000Z");
});
