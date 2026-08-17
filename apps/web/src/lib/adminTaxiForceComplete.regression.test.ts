import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeDropoffDistanceMeters,
  TAXI_COMPLETE_ALLOWED_STATUSES,
} from "./taxiCompleteRideCore";
import {
  assertTaxiDropoffProximity,
  TAXI_DROPOFF_COMPLETE_MAX_METERS,
} from "./taxiProximityGate";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "../..");
const mobileRoot = path.resolve(__dirname, "../../../mobile");

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("driver near dropoff passes proximity gate", () => {
  const near = assertTaxiDropoffProximity({
    driverLat: 40.7128,
    driverLng: -74.006,
    dropoffLat: 40.7129,
    dropoffLng: -74.0061,
  });
  assert.equal(near.ok, true);
  if (near.ok) {
    assert.ok(near.distanceMeters <= TAXI_DROPOFF_COMPLETE_MAX_METERS);
  }
});

test("driver too far from dropoff is refused", () => {
  const far = assertTaxiDropoffProximity({
    driverLat: 40.7128,
    driverLng: -74.006,
    dropoffLat: 40.8,
    dropoffLng: -74.1,
  });
  assert.equal(far.ok, false);
  if (far.ok === false) {
    assert.equal(far.error, "too_far_from_dropoff");
    assert.ok((far.distanceMeters ?? 0) > TAXI_DROPOFF_COMPLETE_MAX_METERS);
  }
});

test("driver complete route keeps GPS gate and has no force-complete bypass", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "app/api/taxi/rides/complete/route.ts"),
    "utf8",
  );
  assert.match(src, /assertTaxiDropoffProximity/);
  assert.match(src, /driver_complete_taxi_ride/);
  assert.doesNotMatch(src, /adminForceCompleteTaxiRide|bypassed_proximity/);
  assert.match(src, /Drivers MUST stay GPS-gated/);
});

test("admin force-complete route exists with manage gate and audit", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "app/api/admin/taxi-rides/force-complete/route.ts"),
    "utf8",
  );
  assert.match(src, /assertCanManageTaxiRides/);
  assert.match(src, /adminForceCompleteTaxiRide/);
  assert.match(src, /writeAdminAuditServer/);
  assert.match(src, /taxi_ride_force_complete/);
  assert.match(src, /admin_force_complete/);
  assert.doesNotMatch(src, /requireTaxiApiUser/);
});

test("admin force-complete core skips proximity and blocks double complete", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/taxiCompleteRideCore.ts"),
    "utf8",
  );
  assert.match(src, /ride_already_completed/);
  assert.match(src, /ride_not_found/);
  assert.match(src, /invalid_status/);
  assert.match(src, /bypassed_proximity/);
  assert.match(src, /refresh_taxi_commissions/);
  assert.match(src, /executeTaxiDriverFareTransfer/);
  assert.match(src, /notifyClientTaxiRideCompleted/);
  assert.match(src, /admin_force_complete/);
  assert.doesNotMatch(src, /\.rpc\(\s*["']driver_complete_taxi_ride["']/);
  assert.ok(TAXI_COMPLETE_ALLOWED_STATUSES.includes("in_progress"));
});

test("admin force-complete UI panel is staff-only and confirms", () => {
  const panel = fs.readFileSync(
    path.join(webRoot, "src/components/AdminTaxiForceCompletePanel.tsx"),
    "utf8",
  );
  const page = fs.readFileSync(
    path.join(webRoot, "app/admin/taxi-rides/[rideId]/page.tsx"),
    "utf8",
  );
  assert.match(panel, /Force complete this ride\?/);
  assert.match(panel, /audit log/);
  assert.match(panel, /Force Complete/);
  assert.match(panel, /\/api\/admin\/taxi-rides\/force-complete/);
  assert.match(page, /AdminTaxiForceCompletePanel/);
  assert.match(page, /canManage/);
});

test("mobile driver surfaces have no Force Complete bypass", () => {
  const panel = fs.readFileSync(
    path.join(mobileRoot, "src/components/driver/DriverTaxiPanel.tsx"),
    "utf8",
  );
  const card = fs.readFileSync(
    path.join(mobileRoot, "src/components/driver/DriverTaxiActiveRideCard.tsx"),
    "utf8",
  );
  assert.doesNotMatch(panel, /Force Complete|forceComplete|force_complete|Complete anyway/i);
  assert.doesNotMatch(card, /Force Complete|forceComplete|force_complete|Complete anyway/i);
});

test("taxi driver chat routes to DriverTaxiChat not order_messages", () => {
  const src = fs.readFileSync(
    path.join(mobileRoot, "src/screens/DriverOrderDetailsScreen.tsx"),
    "utf8",
  );
  assert.match(src, /DriverTaxiChat/);
  assert.match(src, /isTaxiRide && targetRole === "client"/);
});

test("safety recording preserves uploaded client storage path", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/uploadSecurity.ts"),
    "utf8",
  );
  assert.match(src, /Prefer validated client path/);
  assert.match(src, /Object not found/);
});

test("computeDropoffDistanceMeters returns null without coords", () => {
  assert.equal(
    computeDropoffDistanceMeters({
      driverLat: null,
      driverLng: null,
      dropoffLat: 1,
      dropoffLng: 2,
    }),
    null,
  );
  const d = computeDropoffDistanceMeters({
    driverLat: 40.7128,
    driverLng: -74.006,
    dropoffLat: 40.7129,
    dropoffLng: -74.0061,
  });
  assert.ok(d != null && d < 50);
});

console.log("adminTaxiForceComplete regression passed");
