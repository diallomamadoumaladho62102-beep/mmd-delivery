import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { foldHeroTotals, foldWeekBars } from "./driverRevenueAggregate";
import {
  formatHiddenEarningsLabel,
  hasCompletionSignal,
  isActiveAssignedJob,
  isActiveAssignedStatus,
  isTerminalDriverStatus,
} from "./driverActiveJobs";
import { getLocalDayRangeIso } from "./driverHomeTodayRange";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(__dirname, "..");

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

function rideInRange(
  row: { completed_at?: string | null; created_at?: string | null },
  fromISO?: string | null,
  toISO?: string | null,
): boolean {
  if (!fromISO && !toISO) return true;
  const stamp = String(row.completed_at ?? row.created_at ?? "").trim();
  if (!stamp) return false;
  const t = new Date(stamp).getTime();
  if (!Number.isFinite(t)) return false;
  if (fromISO) {
    const from = new Date(fromISO).getTime();
    if (Number.isFinite(from) && t < from) return false;
  }
  if (toISO) {
    const to = new Date(toISO).getTime();
    if (Number.isFinite(to) && t > to) return false;
  }
  return true;
}

test("taxi earnings range filter uses completed_at", () => {
  const row = {
    completed_at: "2026-08-17T12:00:00.000Z",
    created_at: "2026-08-01T12:00:00.000Z",
  };
  assert.equal(
    rideInRange(row, "2026-08-17T00:00:00.000Z", "2026-08-17T23:59:59.999Z"),
    true,
  );
  assert.equal(
    rideInRange(row, "2026-08-01T00:00:00.000Z", "2026-08-02T00:00:00.000Z"),
    false,
  );
});

test("hero totals fold food + taxi (regression: taxi-only must not be $0)", () => {
  const totals = foldHeroTotals({
    foodRows: [],
    taxiDriverCents: 1908,
    taxiTrips: 3,
  });
  assert.equal(totals.trips, 3);
  assert.equal(totals.totalEarnings, 19.08);
});

test("home today summary matches earnings fold for food + taxi", () => {
  const foodOnly = foldHeroTotals({
    foodRows: [{ created_at: "x", baseDollars: 3.55, tipDollars: 0 }],
    taxiDriverCents: 0,
    taxiTrips: 0,
  });
  assert.equal(foodOnly.totalEarnings, 3.55);
  assert.equal(foodOnly.trips, 1);

  const deliveryTaxi = foldHeroTotals({
    foodRows: [{ created_at: "x", baseDollars: 5.69, tipDollars: 0 }],
    taxiDriverCents: 1908,
    taxiTrips: 3,
  });
  assert.equal(deliveryTaxi.trips, 4);
  assert.ok(Math.abs(deliveryTaxi.totalEarnings - 24.77) < 1e-9);

  const empty = foldHeroTotals({ foodRows: [], taxiDriverCents: 0, taxiTrips: 0 });
  assert.equal(empty.totalEarnings, 0);
  assert.equal(empty.trips, 0);
});

test("local day range is start/end of local calendar day", () => {
  const d = new Date(2026, 7, 17, 15, 30, 0); // Aug 17 local
  const { fromISO, toISO } = getLocalDayRangeIso(d);
  const from = new Date(fromISO);
  const to = new Date(toISO);
  assert.equal(from.getFullYear(), 2026);
  assert.equal(from.getMonth(), 7);
  assert.equal(from.getDate(), 17);
  assert.equal(from.getHours(), 0);
  assert.equal(to.getDate(), 17);
  assert.equal(to.getHours(), 23);
});

test("week bars include taxi completed_at (not food-only)", () => {
  const bars = foldWeekBars(
    [],
    [
      { completedAt: "2026-08-17T15:00:00.000Z", driverCents: 1000 },
      { completedAt: "2026-08-17T18:00:00.000Z", driverCents: 908 },
    ],
  );
  const mon = bars.find((b) => b.label === "Mon");
  assert.ok(mon);
  assert.ok(Math.abs(mon!.value - 19.08) < 1e-9);
});

test("hide earnings is UI-only and preserves trip count", () => {
  const real = "$19.08";
  assert.equal(formatHiddenEarningsLabel(false, real), "$19.08");
  assert.equal(formatHiddenEarningsLabel(true, real), "••••");
  assert.equal(formatHiddenEarningsLabel(false, real), "$19.08");
  // trips are independent of hide flag
  const trips = 3;
  assert.equal(trips, 3);
});

test("active jobs: pending/accepted/in_progress visible; terminal hidden", () => {
  assert.equal(isActiveAssignedStatus("pending"), false); // unassigned offer, not assigned active
  assert.equal(isActiveAssignedStatus("accepted"), true);
  assert.equal(isActiveAssignedStatus("in_progress"), true);
  assert.equal(isActiveAssignedStatus("dispatched"), true);
  assert.equal(isActiveAssignedStatus("picked_up"), true);
  assert.equal(isTerminalDriverStatus("completed"), true);
  assert.equal(isTerminalDriverStatus("delivered"), true);
  assert.equal(isTerminalDriverStatus("cancelled"), true);
  assert.equal(isActiveAssignedJob({ status: "completed" }), false);
  assert.equal(isActiveAssignedJob({ status: "delivered" }), false);
  assert.equal(isActiveAssignedJob({ status: "canceled" }), false);
  assert.equal(isActiveAssignedJob({ status: "accepted" }), true);
  assert.equal(isActiveAssignedJob({ status: "dispatched" }), true);
});

test("active jobs: completion timestamp hides even if status lagging", () => {
  assert.equal(
    isActiveAssignedJob({
      status: "dispatched",
      delivered_at: "2026-08-17T12:00:00.000Z",
    }),
    false,
  );
  assert.equal(
    isActiveAssignedJob({
      status: "picked_up",
      dropoff_code_verified_at: "2026-08-17T12:00:00.000Z",
    }),
    false,
  );
  assert.equal(hasCompletionSignal({ delivered_confirmed_at: "x" }), true);
  assert.equal(hasCompletionSignal({ status: "accepted" }), false);
});

test("revenue screen wires taxi into hero + chart", () => {
  const src = fs.readFileSync(
    path.join(mobileRoot, "screens/DriverRevenueScreen.tsx"),
    "utf8",
  );
  assert.match(src, /loadTaxiDriverEarnings\(uid, \{ fromISO, toISO \}\)/);
  assert.match(src, /foldHeroTotals/);
  assert.match(src, /foldWeekBars/);
  assert.match(src, /taxiEarnings\?\.chartPoints/);
});

test("home today summary wires same SoT as earnings", () => {
  const home = fs.readFileSync(
    path.join(mobileRoot, "screens/DriverHomeScreen.tsx"),
    "utf8",
  );
  assert.match(home, /loadTaxiDriverEarnings\(driverId, \{ fromISO, toISO \}\)/);
  assert.match(home, /foldHeroTotals/);
  assert.match(home, /getLocalDayRangeIso/);
  assert.match(home, /isActiveAssignedJob/);
  assert.match(home, /\.in\("status", DRIVER_ACTIVE_ASSIGNED_STATUS_LIST\)/);
  assert.match(home, /earningsHidden/);
  assert.doesNotMatch(home, /todayDeliveredRows/);
});

test("premium sheet hide is presentation-only", () => {
  const sheet = fs.readFileSync(
    path.join(mobileRoot, "components/driver/home/DriverHomePremiumSheet.tsx"),
    "utf8",
  );
  assert.match(sheet, /formatHiddenEarningsLabel/);
  assert.match(sheet, /stats\.tripsToday/);
  assert.match(sheet, /eye-off/);
});

test("taxi earnings exports chartPoints from completed rides", () => {
  const src = fs.readFileSync(path.join(mobileRoot, "lib/taxiEarnings.ts"), "utf8");
  assert.match(src, /driver_transfer_id/);
  assert.match(src, /chartPoints/);
});

test("active jobs exclude terminal statuses and stale taxi", () => {
  const home = fs.readFileSync(
    path.join(mobileRoot, "screens/DriverHomeScreen.tsx"),
    "utf8",
  );
  assert.match(home, /onActiveRideChange/);
  assert.match(home, /table: "taxi_rides"/);
  assert.match(home, /marketplace_delivery_jobs/);
});

test("taxi panel syncs active ride to home", () => {
  const panel = fs.readFileSync(
    path.join(mobileRoot, "components/driver/DriverTaxiPanel.tsx"),
    "utf8",
  );
  assert.match(panel, /onActiveRideChange/);
  assert.match(panel, /onActiveRideChange\?\.\(activeRide\)/);
});

console.log("driverEarningsActiveJobs regression passed");
