#!/usr/bin/env node
/**
 * Apply 20261205120000_real_money_finance_views.sql to linked prod.
 * CREATE OR REPLACE VIEW only. No DELETE/TRUNCATE/DROP TABLE.
 * Also inventories is_test rows that already have Stripe transfer ids (read-only).
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PROJECT_REF = "sjmszohmhudayxawfows";
const MIG_VERSION = "20261205120000";
const MIG_NAME = "real_money_finance_views";
const MIG_FILE = join(
  ROOT,
  "supabase",
  "migrations",
  `${MIG_VERSION}_${MIG_NAME}.sql`,
);
const STAMP = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const BACKUP = join(
  ROOT,
  "backups",
  `supabase-${PROJECT_REF}-real-money-views-${STAMP}`,
);
mkdirSync(BACKUP, { recursive: true });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  writeFileSync(join(BACKUP, "run.log"), `${line}\n`, { flag: "a" });
}

function npxSupabase(args) {
  return spawnSync("npx", ["--yes", "supabase@latest", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    shell: true,
  });
}

function dbQuery(sql, label) {
  const sqlPath = join(BACKUP, `q-${label}.sql`);
  writeFileSync(sqlPath, sql, "utf8");
  const r = npxSupabase(["db", "query", "--linked", "-f", sqlPath]);
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  writeFileSync(join(BACKUP, `q-${label}.out.txt`), out, "utf8");
  if (r.status !== 0) {
    throw new Error(
      `db query failed (${label}): exit ${r.status}\n${out.slice(-4000)}`,
    );
  }
  return out;
}

function assertLinked() {
  const refPath = join(ROOT, "supabase", ".temp", "project-ref");
  if (!existsSync(refPath)) throw new Error("missing supabase/.temp/project-ref");
  const ref = readFileSync(refPath, "utf8").trim();
  if (ref !== PROJECT_REF) {
    throw new Error(`REFUSING linked=${ref} expected=${PROJECT_REF}`);
  }
  log(`linked_ref=${ref}`);
}

function safetyScan() {
  const sql = readFileSync(MIG_FILE, "utf8");
  if (/\b(delete\s+from|truncate|drop\s+table|drop\s+schema|drop\s+view)\b/i.test(sql)) {
    throw new Error("REFUSING: destructive SQL detected");
  }
  if (!/security_invoker\s*=\s*true/i.test(sql)) {
    throw new Error("REFUSING: views must use security_invoker = true");
  }
  log("safety_scan_ok");
}

function alreadyApplied() {
  const out = dbQuery(
    `select version from supabase_migrations.schema_migrations where version = '${MIG_VERSION}';`,
    "already-applied",
  );
  return out.includes(MIG_VERSION);
}

const report = { ok: false, backup: BACKUP, version: MIG_VERSION, steps: [] };

try {
  assertLinked();
  if (!existsSync(MIG_FILE)) throw new Error(`missing ${MIG_FILE}`);
  safetyScan();
  copyFileSync(MIG_FILE, join(BACKUP, "migration-applied.sql"));

  const fn = dbQuery(
    `select to_regprocedure('public.is_user_visible_trip_row(timestamptz, boolean, boolean)') is not null as fn_ok;`,
    "precheck-fn",
  );
  if (!/t\b|true/i.test(fn)) {
    throw new Error(`is_user_visible_trip_row missing:\n${fn}`);
  }

  const already = alreadyApplied();
  report.steps.push({ step: "already_applied_check", already });

  log("APPLY migration SQL...");
  const apply = npxSupabase(["db", "query", "--linked", "-f", MIG_FILE]);
  const applyOut = `${apply.stdout || ""}\n${apply.stderr || ""}`;
  writeFileSync(join(BACKUP, "apply-sql.txt"), applyOut, "utf8");
  if (apply.status !== 0) {
    throw new Error(`APPLY FAILED\n${applyOut.slice(-6000)}`);
  }
  report.steps.push({ step: "apply_sql", ok: true });

  if (!already) {
    log("STAMP schema_migrations...");
    dbQuery(
      `insert into supabase_migrations.schema_migrations (version, name)
       values ('${MIG_VERSION}', '${MIG_NAME}')
       on conflict (version) do nothing;
       select version, name from supabase_migrations.schema_migrations
       where version = '${MIG_VERSION}';`,
      "stamp-migration",
    );
  } else {
    log("version already recorded — re-applied idempotent DDL only");
  }

  const verify = dbQuery(
    `
    select
      to_regclass('public.v_orders_real_money') is not null as orders_view_ok,
      to_regclass('public.v_taxi_rides_real_money') is not null as taxi_view_ok,
      (select reloptions from pg_class where relname = 'v_orders_real_money') as orders_reloptions;
    `,
    "verify-views",
  );
  report.steps.push({ step: "verify", out: verify.slice(0, 2000) });

  const counts = dbQuery(
    `
    select
      (select count(*) from public.orders) as orders_all,
      (select count(*) from public.v_orders_real_money) as orders_real_money,
      (select count(*) from public.orders where coalesce(is_test, false) = true) as orders_is_test,
      (select count(*) from public.orders
        where coalesce(is_test, false) = true
          and coalesce(restaurant_transfer_id, '') <> '') as test_orders_with_restaurant_transfer,
      (select count(*) from public.orders
        where coalesce(is_test, false) = true
          and coalesce(driver_transfer_id, '') <> '') as test_orders_with_driver_transfer,
      (select count(*) from public.taxi_rides) as taxi_all,
      (select count(*) from public.v_taxi_rides_real_money) as taxi_real_money;
    `,
    "audit-counts",
  );
  report.steps.push({ step: "historical_audit", out: counts.slice(0, 4000) });

  report.ok = true;
  writeFileSync(join(BACKUP, "report.json"), JSON.stringify(report, null, 2));
  log("OK real_money_finance_views applied");
  console.log(
    JSON.stringify(
      { ok: true, project: PROJECT_REF, version: MIG_VERSION, backup: BACKUP },
      null,
      2,
    ),
  );
} catch (e) {
  report.ok = false;
  report.error = e instanceof Error ? e.message : String(e);
  writeFileSync(join(BACKUP, "report.json"), JSON.stringify(report, null, 2));
  console.error(report.error);
  process.exit(1);
}
