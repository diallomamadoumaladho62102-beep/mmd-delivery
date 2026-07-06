import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const migration = path.join(
  repoRoot,
  "supabase",
  "migrations",
  "20260731120000_taxi_city_rules_active_compliance.sql",
);

test("compliance events never cancel active rides in SQL scan", () => {
  const sql = fs.readFileSync(migration, "utf8");
  assert.doesNotMatch(sql, /update public\.taxi_rides[\s\S]*status.*cancel/i);
  assert.match(sql, /affects_future_rides boolean not null default true/i);
  assert.match(sql, /driver_profile_suspended/i);
  assert.match(sql, /insurance_expired/i);
  assert.match(sql, /identity_invalid/i);
});

test("cron route exists for active ride compliance", () => {
  const routePath = path.join(
    repoRoot,
    "apps",
    "web",
    "app",
    "api",
    "cron",
    "taxi-active-ride-compliance",
    "route.ts",
  );
  assert.ok(fs.existsSync(routePath));
  const source = fs.readFileSync(routePath, "utf8");
  assert.match(source, /runActiveTaxiRideComplianceScan/);
});
