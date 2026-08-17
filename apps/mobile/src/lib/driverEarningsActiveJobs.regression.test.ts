import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { foldHeroTotals, foldWeekBars } from "./driverRevenueAggregate";

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
    taxiDriverCents: 2485,
    taxiTrips: 4,
  });
  assert.equal(totals.trips, 4);
  assert.equal(totals.totalEarnings, 24.85);
  assert.equal(totals.baseEarnings, 24.85);
  assert.ok(Math.abs(totals.averageTrip - 6.2125) < 1e-9);
});

test("week bars include taxi completed_at (not food-only)", () => {
  // Monday 2026-08-17
  const bars = foldWeekBars(
    [],
    [
      { completedAt: "2026-08-17T15:00:00.000Z", driverCents: 1000 },
      { completedAt: "2026-08-17T18:00:00.000Z", driverCents: 1485 },
    ],
  );
  const mon = bars.find((b) => b.label === "Mon");
  assert.ok(mon);
  assert.ok(Math.abs(mon!.value - 24.85) < 1e-9);
  assert.ok(mon!.h > 10);
  const zeroDays = bars.filter((b) => b.label !== "Mon");
  for (const d of zeroDays) {
    assert.equal(d.value, 0);
  }
});

test("week bars combine food created_at + taxi completed_at", () => {
  const bars = foldWeekBars(
    [
      {
        created_at: "2026-08-18T12:00:00.000Z", // Tue
        baseDollars: 5,
        tipDollars: 1,
      },
    ],
    [{ completedAt: "2026-08-17T12:00:00.000Z", driverCents: 400 }], // Mon $4
  );
  assert.equal(bars.find((b) => b.label === "Mon")?.value, 4);
  assert.equal(bars.find((b) => b.label === "Tue")?.value, 6);
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
  assert.match(src, /Pending Connect transfer/);
  assert.match(src, /Transferred to Connect/);
});

test("taxi earnings exports chartPoints from completed rides", () => {
  const src = fs.readFileSync(path.join(mobileRoot, "lib/taxiEarnings.ts"), "utf8");
  assert.match(src, /driver_transfer_id/);
  assert.match(src, /paid only when Transfer id exists/i);
  assert.match(src, /fromISO/);
  assert.match(src, /completed_at/);
  assert.match(src, /chartPoints/);
});

test("active jobs exclude terminal statuses and stale taxi", () => {
  const home = fs.readFileSync(
    path.join(mobileRoot, "screens/DriverHomeScreen.tsx"),
    "utf8",
  );
  assert.match(home, /isTerminalDriverStatus\(order\.status\)/);
  assert.match(home, /accepted.*driver_arrived.*in_progress/s);
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
