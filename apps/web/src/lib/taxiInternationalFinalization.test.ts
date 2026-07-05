import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  driverMatchesTaxiRideCategory,
  isElectricSearchActive,
  normalizeTaxiRideCategory,
  resolveElectricSearchSeconds,
  taxiFuelTypeIsGreen,
} from "./taxiCategoryMatching";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const taxiMigration = path.join(
  repoRoot,
  "supabase",
  "migrations",
  "20260729120000_taxi_international_finalization.sql",
);

test("normalizeTaxiRideCategory maps premium to comfort", () => {
  assert.equal(normalizeTaxiRideCategory("premium"), "comfort");
});

test("comfort with acceptAlsoStandard can receive standard rides", () => {
  assert.equal(
    driverMatchesTaxiRideCategory({
      rideClass: "standard",
      eligibleCategories: ["comfort"],
      acceptAlsoStandard: true,
    }),
    true,
  );
});

test("comfort without acceptAlsoStandard cannot receive standard rides", () => {
  assert.equal(
    driverMatchesTaxiRideCategory({
      rideClass: "standard",
      eligibleCategories: ["comfort"],
      acceptAlsoStandard: false,
    }),
    false,
  );
});

test("standard driver cannot receive comfort rides", () => {
  assert.equal(
    driverMatchesTaxiRideCategory({
      rideClass: "comfort",
      eligibleCategories: ["standard"],
      acceptAlsoStandard: true,
    }),
    false,
  );
});

test("xl cannot receive comfort rides", () => {
  assert.equal(
    driverMatchesTaxiRideCategory({
      rideClass: "comfort",
      eligibleCategories: ["xl"],
      acceptAlsoStandard: true,
    }),
    false,
  );
});

test("wheelchair only receives wheelchair rides", () => {
  assert.equal(
    driverMatchesTaxiRideCategory({
      rideClass: "wheelchair_accessible",
      eligibleCategories: ["wheelchair_accessible"],
      acceptAlsoStandard: false,
    }),
    true,
  );
  assert.equal(
    driverMatchesTaxiRideCategory({
      rideClass: "xl",
      eligibleCategories: ["wheelchair_accessible"],
      acceptAlsoStandard: true,
    }),
    false,
  );
});

test("taxiFuelTypeIsGreen recognizes electric and hybrid", () => {
  assert.equal(taxiFuelTypeIsGreen("electric"), true);
  assert.equal(taxiFuelTypeIsGreen("hybrid"), true);
  assert.equal(taxiFuelTypeIsGreen("plug_in_hybrid"), true);
  assert.equal(taxiFuelTypeIsGreen("gasoline"), false);
});

test("electric search window active before deadline", () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.equal(
    isElectricSearchActive({
      preferElectricOrHybrid: true,
      electricSearchExpired: false,
      electricSearchUntil: future,
    }),
    true,
  );
});

test("electric search expired after deadline", () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  assert.equal(
    isElectricSearchActive({
      preferElectricOrHybrid: true,
      electricSearchExpired: false,
      electricSearchUntil: past,
      now: new Date(),
    }),
    false,
  );
});

test("resolveElectricSearchSeconds prefers city rule", () => {
  const seconds = resolveElectricSearchSeconds(
    [
      { country_code: null, city: null, electric_search_seconds: 30 },
      { country_code: "US", city: "brooklyn", electric_search_seconds: 45 },
    ],
    "US",
    "Brooklyn",
  );
  assert.equal(seconds, 45);
});

test("migration defines validate_taxi_offer_acceptance", () => {
  const sql = fs.readFileSync(taxiMigration, "utf8");
  assert.match(sql, /validate_taxi_offer_acceptance/i);
  assert.match(sql, /taxi_accept_audit_events/i);
  assert.match(sql, /set_driver_active_vehicle/i);
  assert.match(sql, /driver_matches_taxi_ride_category/i);
});

test("migration rewrites driver_accept_taxi_offer with audit on failure", () => {
  const sql = fs.readFileSync(taxiMigration, "utf8");
  assert.match(sql, /should_redispatch/i);
  assert.match(sql, /identity_not_verified/i);
  assert.match(sql, /assigned_vehicle_id/i);
});

test("multi-vehicle active_vehicle_id on driver_profiles", () => {
  const sql = fs.readFileSync(taxiMigration, "utf8");
  assert.match(sql, /active_vehicle_id/i);
  assert.match(sql, /driver_vehicle_history/i);
});

test("accept guard blocks offline driver", () => {
  const sql = fs.readFileSync(taxiMigration, "utf8");
  assert.match(sql, /driver_offline/i);
  assert.match(sql, /must_be_offline/i);
});

test("performance: category matching for 10000 checks under 500ms", () => {
  const start = performance.now();
  for (let i = 0; i < 10_000; i += 1) {
    driverMatchesTaxiRideCategory({
      rideClass: i % 2 === 0 ? "standard" : "comfort",
      eligibleCategories: i % 3 === 0 ? ["comfort"] : ["standard"],
      acceptAlsoStandard: i % 4 === 0,
    });
  }
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 500, `too slow: ${elapsed}ms`);
});
