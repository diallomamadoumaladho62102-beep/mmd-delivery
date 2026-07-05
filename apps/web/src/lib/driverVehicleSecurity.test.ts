import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const baseMigration = path.join(
  repoRoot,
  "supabase",
  "migrations",
  "20260728120000_driver_service_preferences_vehicle_eligibility.sql",
);
const hardeningMigration = path.join(
  repoRoot,
  "supabase",
  "migrations",
  "20260728130000_driver_vehicle_eligibility_hardening.sql",
);

test("migrations enable RLS on sensitive tables", () => {
  const sql = fs.readFileSync(baseMigration, "utf8") + fs.readFileSync(hardeningMigration, "utf8");
  assert.match(sql, /driver_service_preferences enable row level security/i);
  assert.match(sql, /vehicle_category_eligibility enable row level security/i);
  assert.match(sql, /driver_vehicles enable row level security/i);
});

test("drivers cannot write vehicle_category_eligibility", () => {
  const sql = fs.readFileSync(hardeningMigration, "utf8");
  assert.match(sql, /revoke insert, update, delete on public\.vehicle_category_eligibility from authenticated/i);
});

test("driver vehicle trigger blocks document self-approval", () => {
  const sql = fs.readFileSync(hardeningMigration, "utf8");
  assert.match(sql, /new\.inspection_status := old\.inspection_status/i);
  assert.match(sql, /new\.wheelchair_equipment_verified := old\.wheelchair_equipment_verified/i);
});

test("is_taxi_driver_eligible checks service preference", () => {
  const sql = fs.readFileSync(baseMigration, "utf8");
  assert.match(sql, /is_driver_service_enabled\(p_user_id, 'taxi'\)/i);
});

test("online gate requires at least one service", () => {
  const sql = fs.readFileSync(baseMigration, "utf8");
  assert.match(sql, /driver_no_service_enabled/i);
  assert.match(sql, /driver_has_any_service_enabled/i);
});

test("country/city rule resolver exists", () => {
  const sql = fs.readFileSync(hardeningMigration, "utf8");
  assert.match(sql, /resolve_vehicle_category_rule/i);
});

test("year refresh cron function exists", () => {
  const sql = fs.readFileSync(hardeningMigration, "utf8");
  assert.match(sql, /refresh_all_vehicle_category_eligibility/i);
});

test("notification audit table exists", () => {
  const sql = fs.readFileSync(hardeningMigration, "utf8");
  assert.match(sql, /driver_vehicle_notification_events/i);
});
