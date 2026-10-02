import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const webRoot = process.cwd();
const migration = readFileSync(
  join(webRoot, "../../supabase/migrations/20261206120000_driver_integrity_anti_abuse.sql"),
  "utf8"
);
const hardening = readFileSync(
  join(webRoot, "../../supabase/migrations/20261207120000_pre_shadow_hardening.sql"),
  "utf8"
);
const scan = readFileSync(join(webRoot, "src/lib/driverIntegrity/scan.ts"), "utf8");
const settingsApi = readFileSync(
  join(webRoot, "app/api/admin/driver-integrity/settings/route.ts"),
  "utf8"
);
const cron = readFileSync(join(webRoot, "app/api/cron/driver-integrity/route.ts"), "utf8");
const v1 = readFileSync(
  join(webRoot, "src/lib/pricingEngine/engine/compute/deliveryFeeV1.ts"),
  "utf8"
);
const mpSettings = readFileSync(
  join(webRoot, "src/lib/minimumPay/engineGate.ts"),
  "utf8"
);

test("migration defaults every feature flag to false", () => {
  assert.match(migration, /monitoring_enabled boolean not null default false/);
  assert.match(migration, /warning_notifications_enabled boolean not null default false/);
  assert.match(migration, /reassignment_enabled boolean not null default false/);
  assert.match(migration, /sanction_workflow_enabled boolean not null default false/);
});

test("thresholds are nullable, never seeded with business values", () => {
  assert.match(migration, /driver_acceptance_warning_after_seconds integer/);
  assert.doesNotMatch(migration, /driver_acceptance_warning_after_seconds integer not null default \d+/);
  assert.doesNotMatch(migration, /insert into public\.driver_integrity_settings[\s\S]*120/);
});

test("reassignment RPCs are revoked from authenticated and granted to service_role", () => {
  assert.match(migration, /revoke all on function public\.driver_integrity_reassign_order/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.driver_integrity_reassign_order[\s\S]*to service_role/);
});

test("reassignment does not null driver_accepted_at", () => {
  assert.doesNotMatch(migration, /driver_accepted_at\s*=\s*null/);
  assert.match(migration, /preserved_driver_accepted_at/);
});

test("incident original accept clock is frozen", () => {
  assert.match(migration, /new\.original_driver_accepted_at := old\.original_driver_accepted_at/);
});

test("RLS is enabled on integrity tables", () => {
  assert.match(migration, /alter table public\.driver_integrity_incidents enable row level security/);
  assert.match(migration, /alter table public\.driver_wait_reasons enable row level security/);
  assert.match(migration, /driver_id = auth\.uid\(\)/);
});

test("scan is fail-closed when monitoring is off and uses cron lock", () => {
  assert.match(scan, /failClosedScanSkipReason/);
  assert.match(scan, /acquireCronJobLock/);
  assert.match(scan, /driver_integrity_scan/);
});

test("admin settings API is RBAC protected", () => {
  assert.match(settingsApi, /assertStaffPermission\("driver_integrity.read"/);
  assert.match(settingsApi, /assertStaffPermission\("driver_integrity.manage"/);
});

test("cron requires CRON_SECRET style auth", () => {
  assert.match(cron, /isAuthorizedCronRequest/);
  assert.match(cron, /buildCronSupabaseAdmin/);
  assert.match(cron, /maxDuration = 60/);
});

test("V1 deliveryFee file is not modified by this phase", () => {
  assert.doesNotMatch(v1, /driverIntegrity/);
  assert.doesNotMatch(v1, /driver_integrity/);
});

test("minimum pay engine gate is not activated by integrity code", () => {
  assert.doesNotMatch(scan, /canTransferMinimumPayAdjustments/);
  assert.doesNotMatch(scan, /transfersEnabled/);
  assert.doesNotMatch(mpSettings, /driver_integrity/);
});

test("no 10-minute stop-pay rule exists", () => {
  assert.doesNotMatch(scan, /wait > 10/);
  assert.doesNotMatch(migration, /stop pay/);
  assert.doesNotMatch(scan, /automaticFraud = true/);
});

test("hardening keeps marketplace RPC service_role-only and flags off", () => {
  assert.match(hardening, /revoke all on function public\.driver_integrity_reassign_marketplace_job/);
  assert.match(hardening, /grant execute on function public\.driver_integrity_reassign_marketplace_job[\s\S]*to service_role/);
  assert.doesNotMatch(hardening, /monitoring_enabled\s*=\s*true/);
});
