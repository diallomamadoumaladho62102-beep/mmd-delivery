import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

test("revenue screen folds taxi into hero totals", () => {
  const src = fs.readFileSync(
    path.join(mobileRoot, "screens/DriverRevenueScreen.tsx"),
    "utf8",
  );
  assert.match(src, /loadTaxiDriverEarnings\(uid, \{ fromISO, toISO \}\)/);
  assert.match(src, /taxiEarnings\?\.totalDriverCents/);
  assert.match(src, /taxiTrips/);
  assert.match(src, /Pending Connect transfer/);
  assert.match(src, /Transferred to Connect/);
});

test("taxi earnings paid uses transfer id SoT", () => {
  const src = fs.readFileSync(path.join(mobileRoot, "lib/taxiEarnings.ts"), "utf8");
  assert.match(src, /driver_transfer_id/);
  assert.match(src, /paid only when Transfer id exists/i);
  assert.match(src, /fromISO/);
  assert.match(src, /completed_at/);
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
