import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeTaxiCityName,
  resolveTaxiDispatchRuleScope,
} from "./taxiCityDetection";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const migration = path.join(
  repoRoot,
  "supabase",
  "migrations",
  "20260731120000_taxi_city_rules_active_compliance.sql",
);

test("normalizeTaxiCityName lowercases and trims", () => {
  assert.equal(normalizeTaxiCityName("  Paris  "), "paris");
  assert.equal(normalizeTaxiCityName(""), null);
});

test("resolveTaxiDispatchRuleScope normalizes country and city", () => {
  const scope = resolveTaxiDispatchRuleScope({
    countryCode: "fr",
    pickupCity: " Lyon ",
  });
  assert.equal(scope.countryCode, "FR");
  assert.equal(scope.pickupCity, "lyon");
});

test("migration adds pickup_city and compliance scan", () => {
  const sql = fs.readFileSync(migration, "utf8");
  assert.match(sql, /pickup_city/i);
  assert.match(sql, /normalize_taxi_city_name/i);
  assert.match(sql, /scan_active_taxi_ride_compliance/i);
  assert.match(sql, /taxi_ride_compliance_events/i);
  assert.match(sql, /resolve_taxi_dispatch_preference_rules/);
});

test("migration resolver uses city before country before global", () => {
  const sql = fs.readFileSync(migration, "utf8");
  assert.match(sql, /if v_city is not null then/i);
  assert.match(sql, /v_ride\.pickup_city/i);
});
