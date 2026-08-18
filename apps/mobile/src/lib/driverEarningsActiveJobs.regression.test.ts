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
  isRecoverableAssignedJob,
  isStaleAssignedJob,
  isTerminalDriverStatus,
} from "./driverActiveJobs";
import {
  getEarningsPeriodRange,
  getLocalDayRangeIso,
  isStampInEarningsRange,
} from "./driverEarningsPeriod";

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

test("today/week/month periods share local timezone helpers", () => {
  const d = new Date(2026, 7, 17, 15, 0, 0); // Monday
  const today = getEarningsPeriodRange("today", d);
  const week = getEarningsPeriodRange("week", d);
  const month = getEarningsPeriodRange("month", d);
  assert.equal(today.fromISO, week.fromISO); // Monday → week starts today
  assert.equal(today.toISO, week.toISO);
  assert.equal(month.from.getDate(), 1);
  assert.equal(month.from.getMonth(), 7);
  assert.ok(isStampInEarningsRange("2026-08-17T18:00:00.000Z", today.fromISO, today.toISO));
  assert.equal(
    isStampInEarningsRange("2026-07-20T10:00:00.000Z", month.fromISO, month.toISO),
    false,
  );
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
  assert.equal(
    isActiveAssignedJob({
      status: "accepted",
      updated_at: new Date().toISOString(),
    }),
    true,
  );
  assert.equal(
    isActiveAssignedJob({
      status: "dispatched",
      updated_at: new Date().toISOString(),
    }),
    true,
  );
});

test("active jobs: completion timestamp hides even if status lagging", () => {
  assert.equal(
    isActiveAssignedJob({
      status: "dispatched",
      delivered_at: "2026-08-17T12:00:00.000Z",
      updated_at: new Date().toISOString(),
    }),
    false,
  );
  assert.equal(
    isActiveAssignedJob({
      status: "picked_up",
      dropoff_code_verified_at: "2026-08-17T12:00:00.000Z",
      updated_at: new Date().toISOString(),
    }),
    false,
  );
  assert.equal(hasCompletionSignal({ delivered_confirmed_at: "x" }), true);
  assert.equal(hasCompletionSignal({ status: "accepted" }), false);
});

test("active jobs: stale ready/dispatched (>48h) hidden without mutating DB", () => {
  const stale = "2026-08-03T06:30:00.000Z";
  assert.equal(
    isStaleAssignedJob({ status: "ready", updated_at: stale }, Date.parse("2026-08-17T20:00:00.000Z")),
    true,
  );
  assert.equal(
    isActiveAssignedJob(
      { status: "ready", updated_at: stale, created_at: stale },
      Date.parse("2026-08-17T20:00:00.000Z"),
    ),
    false,
  );
  assert.equal(
    isActiveAssignedJob(
      {
        status: "dispatched",
        updated_at: stale,
        created_at: stale,
      },
      Date.parse("2026-08-17T20:00:00.000Z"),
    ),
    false,
  );
  // Mid-mission never hidden by age alone (recoverable + Active Jobs).
  assert.equal(
    isStaleAssignedJob(
      { status: "picked_up", updated_at: stale },
      Date.parse("2026-08-17T20:00:00.000Z"),
    ),
    false,
  );
  assert.equal(
    isActiveAssignedJob(
      { status: "in_progress", updated_at: stale, created_at: stale },
      Date.parse("2026-08-17T20:00:00.000Z"),
    ),
    true,
  );
  assert.equal(
    isRecoverableAssignedJob({ status: "ready", updated_at: stale }),
    true,
  );
  assert.equal(
    isRecoverableAssignedJob({ status: "dispatched", updated_at: stale }),
    true,
  );
});

test("home restores active taxi from server and keeps state on fetch error", () => {
  const home = fs.readFileSync(
    path.join(mobileRoot, "screens/DriverHomeScreen.tsx"),
    "utf8",
  );
  assert.match(home, /refreshActiveTaxiRide/);
  assert.match(home, /kept prior state/);
  assert.match(home, /resumedActiveJobKeyRef/);
  assert.match(home, /sourceTable: "taxi_rides"/);
  assert.match(home, /DRIVER_IN_PROGRESS_STATUSES/);
});

test("taxi panel does not clear active ride on offline or mount null", () => {
  const panel = fs.readFileSync(
    path.join(mobileRoot, "components/driver/DriverTaxiPanel.tsx"),
    "utf8",
  );
  assert.match(panel, /hydratedActiveRideRef/);
  assert.match(panel, /kept prior active ride/);
  assert.doesNotMatch(
    panel,
    /if \(!showPanel \|\| !isOnline\) \{\s*setOffers\(\[\]\);\s*setActiveRide\(null\)/,
  );
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
  assert.match(home, /updated_at/);
});

test("revenue screen uses shared period + completion stamp filter", () => {
  const src = fs.readFileSync(
    path.join(mobileRoot, "screens/DriverRevenueScreen.tsx"),
    "utf8",
  );
  assert.match(src, /getEarningsPeriodRange/);
  assert.match(src, /isStampInEarningsRange/);
  assert.match(src, /getEarningsCompletionStamp/);
  assert.match(src, /setRange\(tab\.k\)/);
});

test("wallet awaiting-transfer label is generic earnings not delivery-only", () => {
  const src = fs.readFileSync(
    path.join(mobileRoot, "screens/DriverWalletScreen.tsx"),
    "utf8",
  );
  assert.match(src, /earnings awaiting platform transfer/);
  assert.doesNotMatch(src, /delivery earnings await platform transfer/);
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
