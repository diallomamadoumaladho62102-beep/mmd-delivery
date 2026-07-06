import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.join(
  process.cwd(),
  "../../supabase/migrations/20260731300000_fix_profiles_signup_role_guard.sql"
);

const sql = fs.readFileSync(migrationPath, "utf8");

assert.match(sql, /new\.role not in \('client', 'driver', 'restaurant'\)/);
assert.match(sql, /new\.role := old\.role/);

console.log("profilesSignupRoleGuard migration tests passed");
