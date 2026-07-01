/**
 * Validates Supabase migration filenames in supabase/migrations/.
 * Run: node scripts/verify-migration-files.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "supabase", "migrations");
const pattern = /^\d{14}_[a-z0-9_]+\.sql$/i;

const entries = fs.readdirSync(dir, { withFileTypes: true });
const files = entries.filter((e) => e.isFile()).map((e) => e.name);
const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

let failed = false;

if (dirs.length) {
  console.error("FAIL: nested directories in supabase/migrations:", dirs.join(", "));
  failed = true;
}

const invalid = files.filter((name) => !pattern.test(name));
const valid = files.filter((name) => pattern.test(name)).sort();

if (invalid.length) {
  console.error("FAIL: invalid migration filenames (must be YYYYMMDDHHMMSS_name.sql):");
  for (const name of invalid) {
    console.error("  -", name);
  }
  failed = true;
}

if (valid.length < 50) {
  console.error("FAIL: expected at least 50 timestamped migrations, found", valid.length);
  failed = true;
}

const required = [
  "20260716120000_food_order_trust_boundary.sql",
  "20260717120000_production_hardening_p0_p1.sql",
  "20260720120000_driver_locations_participant_read.sql",
  "20260602130000_driver_map_reports_v1_1.sql",
];

for (const name of required) {
  if (!valid.includes(name)) {
    console.error("FAIL: missing required migration", name);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log("verify-migration-files: OK", valid.length, "migrations");
console.log("  first:", valid[0]);
console.log("  last:", valid[valid.length - 1]);
