import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const migrationPath = path.join(
  repoRoot,
  "supabase",
  "migrations",
  "20260726120000_driver_identity_verification.sql",
);

test("driver identity migration defines RLS and private bucket", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");

  assert.match(sql, /driver_identity_checks/);
  assert.match(sql, /driver_identity_events/);
  assert.match(sql, /driver_identity_settings/);
  assert.match(sql, /driver-identity-selfies/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /enforce_driver_identity_online_gate/);
  assert.match(sql, /'driver-identity-selfies',\s*\n\s*'driver-identity-selfies',\s*\n\s*false/);
});

test("driver identity migration prevents driver bypass of online gate", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /driver_identity_verification_required/);
  assert.doesNotMatch(sql, /policy driver_identity_checks_update_own/);
});

test("driver identity migration includes provider fields for future vendors", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /provider text/);
  assert.match(sql, /provider_reference text/);
});

test("driver identity migration audits events table", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /driver_identity_events/);
  assert.match(sql, /driver_identity_log_event/);
});
