import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  defaultTaxiAddressConfig,
  resolveTaxiAddressConfig,
} from "./taxiAddressConfig";
import { buildRoundTripRouteInput } from "./taxiTripMode";
import {
  assertTaxiDropoffProximity,
  assertTaxiPickupProximity,
  parseRequiredTaxiGps,
} from "./taxiProximityGate";

function testAddressConfigUsVsGn() {
  const us = defaultTaxiAddressConfig("US");
  assert.equal(us.structured_address_mode, true);
  assert.equal(us.street_number_required, true);
  assert.equal(us.postal_code_required, true);
  assert.equal(us.landmark_prompt_required, false);
  assert.equal(us.manual_pin_confirmation_required, false);

  const gn = defaultTaxiAddressConfig("GN");
  assert.equal(gn.structured_address_mode, false);
  assert.equal(gn.landmark_prompt_required, true);
  assert.equal(gn.manual_pin_confirmation_required, true);
  assert.equal(gn.street_number_required, false);

  const overridden = resolveTaxiAddressConfig("US", {
    address_config: { landmark_prompt_required: true },
  });
  assert.equal(overridden.structured_address_mode, true);
  assert.equal(overridden.landmark_prompt_required, true);
}

function testRoundTripRouteInputBuildsReturnToPickup() {
  const input = {
    pickupAddress: "Pickup St",
    dropoffAddress: "Dropoff Ave",
    pickupLat: 40.7,
    pickupLng: -74.0,
    dropoffLat: 40.75,
    dropoffLng: -73.98,
    stops: [{ address: "Mid Stop", lat: 40.72, lng: -73.99 }],
  };

  const oneWay = buildRoundTripRouteInput(input, "one_way");
  assert.equal(oneWay.dropoffAddress, "Dropoff Ave");
  assert.equal(oneWay.stops?.length, 1);

  const round = buildRoundTripRouteInput(input, "round_trip");
  assert.equal(round.dropoffAddress, "Pickup St");
  assert.equal(round.dropoffLat, 40.7);
  assert.equal(round.dropoffLng, -74.0);
  assert.ok(Array.isArray(round.stops));
  assert.equal(round.stops!.length, 2);
  assert.equal(round.stops![1]?.address, "Dropoff Ave");
  assert.equal(round.stops![1]?.lat, 40.75);
}

function testProximityGatesTooFar() {
  const missingGps = parseRequiredTaxiGps({});
  assert.equal(missingGps.ok, false);
  if (missingGps.ok === false) {
    assert.equal(missingGps.error, "driver_gps_required");
  }

  const pickupFar = assertTaxiPickupProximity({
    driverLat: 40.7,
    driverLng: -74.0,
    pickupLat: 40.75,
    pickupLng: -73.9,
  });
  assert.equal(pickupFar.ok, false);
  if (pickupFar.ok === false) {
    assert.ok(
      pickupFar.error === "too_far_from_pickup" ||
        pickupFar.error === "manual_arrival_required",
    );
  }

  const dropoffFar = assertTaxiDropoffProximity({
    driverLat: 40.7,
    driverLng: -74.0,
    dropoffLat: 40.8,
    dropoffLng: -73.8,
  });
  assert.equal(dropoffFar.ok, false);
  if (dropoffFar.ok === false) {
    assert.equal(dropoffFar.error, "too_far_from_dropoff");
  }
}

function testMigrationContainsGpsAndAddressConfig() {
  const migrationPath = join(
    process.cwd(),
    "..",
    "..",
    "supabase",
    "migrations",
    "20260817120000_taxi_phase5_production_hardening.sql",
  );
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(sql, /address_config/);
  assert.match(sql, /driver_arrive_taxi_pickup/);
  assert.match(sql, /driver_complete_taxi_ride/);
  assert.match(sql, /driver_gps_required/);
  assert.match(sql, /trip_mode/);
}

function testArriveRouteRequiresGps() {
  const arrivePath = join(
    process.cwd(),
    "app",
    "api",
    "taxi",
    "rides",
    "arrive",
    "route.ts",
  );
  const src = readFileSync(arrivePath, "utf8");
  assert.match(src, /parseRequiredTaxiGps/);
  assert.match(src, /driver_gps_required|gps\.ok === false/);
}

function testAcceptRouteNotifiesClient() {
  const acceptPath = join(
    process.cwd(),
    "app",
    "api",
    "taxi",
    "offers",
    "accept",
    "route.ts",
  );
  const src = readFileSync(acceptPath, "utf8");
  assert.match(src, /notifyClientTaxiRideAccepted/);
}

function main() {
  testAddressConfigUsVsGn();
  testRoundTripRouteInputBuildsReturnToPickup();
  testProximityGatesTooFar();
  testMigrationContainsGpsAndAddressConfig();
  testArriveRouteRequiresGps();
  testAcceptRouteNotifiesClient();
  console.log("taxiPhase5.test.ts OK");
}

main();
