#!/usr/bin/env node
/** Apply 20261125160000_taxi_rating_ratee_role_guard.sql to linked prod. */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIG_VERSION = "20261125160000";
const MIG_FILE = join(
  ROOT,
  "supabase",
  "migrations",
  `${MIG_VERSION}_taxi_rating_ratee_role_guard.sql`,
);
const STAMP = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const BACKUP = join(ROOT, "backups", `supabase-rating-ratee-guard-${STAMP}`);
mkdirSync(BACKUP, { recursive: true });

function npxSupabase(args) {
  return spawnSync("npx", ["--yes", "supabase@latest", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    shell: true,
  });
}

function dbQuery(sql, label) {
  const sqlPath = join(BACKUP, `q-${label}.sql`);
  writeFileSync(sqlPath, sql, "utf8");
  const r = npxSupabase(["db", "query", "--linked", "-f", sqlPath]);
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  writeFileSync(join(BACKUP, `q-${label}.out.txt`), out, "utf8");
  if (r.status !== 0) throw new Error(`db query ${label} failed: ${out}`);
  return out;
}

const sql = readFileSync(MIG_FILE, "utf8");
if (
  !/coalesce\(tr\.ratee_role, 'driver'\) = 'driver'/.test(sql) ||
  !/coalesce\(new\.ratee_role, 'driver'\) <> 'driver'/.test(sql)
) {
  console.error("safety_scan_failed");
  process.exit(1);
}

const already = dbQuery(
  `select version from supabase_migrations.schema_migrations where version = '${MIG_VERSION}';`,
  "already",
);
if (already.includes(MIG_VERSION)) {
  console.log(JSON.stringify({ ok: true, already_applied: true }, null, 2));
  process.exit(0);
}

dbQuery(sql, "apply");
dbQuery(
  `insert into supabase_migrations.schema_migrations (version) values ('${MIG_VERSION}') on conflict do nothing;`,
  "stamp",
);
const verify = dbQuery(
  "select pg_get_functiondef('public.apply_taxi_ride_rating_to_driver_summary()'::regprocedure) as def;",
  "verify",
);
// JSON/CLI may escape <> as \\u003c\\u003e — accept either form.
const ok =
  verify.includes("ratee_role") &&
  (verify.includes("<> 'driver'") ||
    verify.includes("\\u003c\\u003e 'driver'") ||
    /must not pollute/.test(verify));
console.log(JSON.stringify({ ok, verify_ok: ok }, null, 2));
process.exit(ok ? 0 : 1);
