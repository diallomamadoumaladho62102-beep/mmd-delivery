import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  computeClientOrderStats,
  isClientActiveStatus,
  isVisibleClientTrip,
  selectClientHomeDisplayItems,
} from "./clientOrderDisplay";

test("hides archived/test trips", () => {
  assert.equal(
    isVisibleClientTrip({
      id: "1",
      kind: "restaurant_order",
      status: "delivered",
      is_test: true,
    }),
    false,
  );
  assert.equal(
    isVisibleClientTrip({
      id: "2",
      kind: "restaurant_order",
      status: "delivered",
      hidden_from_user: true,
    }),
    false,
  );
  assert.equal(
    isVisibleClientTrip({
      id: "3",
      kind: "restaurant_order",
      status: "delivered",
      archived_at: "2026-01-01",
    }),
    false,
  );
});

test("no active + several completed → only last completed", () => {
  const items = [
    {
      id: "a",
      kind: "restaurant_order" as const,
      status: "delivered",
      created_at: "2026-07-01T10:00:00Z",
    },
    {
      id: "b",
      kind: "delivery_request" as const,
      status: "delivered",
      created_at: "2026-07-10T10:00:00Z",
    },
    {
      id: "c",
      kind: "taxi_ride" as const,
      status: "completed",
      created_at: "2026-07-05T10:00:00Z",
    },
  ];
  const { displayItems, mode } = selectClientHomeDisplayItems(items);
  assert.equal(mode, "last_completed");
  assert.equal(displayItems.length, 1);
  assert.equal(displayItems[0].id, "b");
});

test("multiple actives all shown", () => {
  const items = [
    {
      id: "1",
      kind: "restaurant_order" as const,
      status: "dispatched",
      created_at: "2026-07-10T10:00:00Z",
    },
    {
      id: "2",
      kind: "taxi_ride" as const,
      status: "in_progress",
      created_at: "2026-07-10T11:00:00Z",
    },
    {
      id: "3",
      kind: "delivery_request" as const,
      status: "delivered",
      created_at: "2026-07-01T10:00:00Z",
    },
  ];
  const { displayItems, mode } = selectClientHomeDisplayItems(items);
  assert.equal(mode, "active");
  assert.equal(displayItems.length, 2);
  assert.ok(displayItems.every((i) => isClientActiveStatus(i.status)));
});

test("stats exclude cancelled from active and count accurately", () => {
  const stats = computeClientOrderStats([
    { id: "1", kind: "restaurant_order", status: "dispatched" },
    { id: "2", kind: "restaurant_order", status: "delivered" },
    { id: "3", kind: "taxi_ride", status: "canceled" },
    {
      id: "4",
      kind: "delivery_request",
      status: "delivered",
      is_test: true,
    },
  ]);
  assert.equal(stats.active, 1);
  assert.equal(stats.completed, 1);
  assert.equal(stats.cancelled, 1);
  assert.equal(stats.totalOrders, 3);
});

test("test data not mixed into in-progress selection", () => {
  const { displayItems, mode } = selectClientHomeDisplayItems([
    {
      id: "live",
      kind: "restaurant_order",
      status: "delivered",
      created_at: "2026-07-10T10:00:00Z",
    },
    {
      id: "test",
      kind: "restaurant_order",
      status: "dispatched",
      created_at: "2026-07-11T10:00:00Z",
      is_test: true,
    },
  ]);
  assert.equal(mode, "last_completed");
  assert.equal(displayItems[0].id, "live");
});

test("migration includes soft-archive and capacity settings", () => {
  const mig = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../supabase/migrations/20260914120000_order_cleanup_and_driver_capacity.sql",
    ),
    "utf8",
  );
  assert.match(mig, /driver_capacity_settings/);
  assert.match(mig, /max_active_delivery_missions/);
  assert.match(mig, /taxi_driver_next_ride_eligible/);
  assert.match(mig, /pg_advisory_xact_lock/);
  assert.match(mig, /status = 'queued'/);
  assert.match(mig, /hidden_from_user/);
  assert.match(mig, /mission_capacity_reached/);
});
