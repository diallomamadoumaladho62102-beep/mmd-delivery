#!/usr/bin/env node
/**
 * Apply 20261204120000_partner_transfer_recoveries.sql to linked prod.
 * Idempotent create table. No destructive SQL. No Stripe/money movement.
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
const MIG_VERSION = "20261204120000";
const MIG_NAME = "partner_transfer_recoveries";
const MIG_FILE = join(
  ROOT,
  "supabase",
  "migrations",
  `${MIG_VERSION}_${MIG_NAME}.sql`
);
const STAMP = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const BACKUP = join(
  ROOT,
  "backups",
  `supabase-${PROJECT_REF}-partner-recoveries-${STAMP}`
);
mkdirSync(BACKUP, { recursive: true });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  writeFileSync(join(BACKUP, "run.log"), line + "\n", { flag: "a" });
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
      `db query failed (${label}): exit ${r.status}\n${out.slice(-4000)}`
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
  if (/\b(delete\s+from|truncate|drop\s+table|drop\s+schema)\b/i.test(sql)) {
    throw new Error("REFUSING: destructive SQL detected");
  }
  log("safety_scan_ok");
}

function alreadyApplied() {
  const out = dbQuery(
    `select version from supabase_migrations.schema_migrations where version = '${MIG_VERSION}';`,
    "already-applied"
  );
  return out.includes(MIG_VERSION);
}

const report = { ok: false, backup: BACKUP, version: MIG_VERSION, steps: [] };

try {
  assertLinked();
  if (!existsSync(MIG_FILE)) throw new Error(`missing ${MIG_FILE}`);
  safetyScan();
  copyFileSync(MIG_FILE, join(BACKUP, "migration-applied.sql"));

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
      "stamp-migration"
    );
  } else {
    log("version already recorded — re-applied idempotent DDL only");
  }

  const verify = dbQuery(
    `
    select
      to_regclass('public.partner_transfer_recoveries') is not null as table_ok,
      (select count(*) from pg_indexes where tablename = 'partner_transfer_recoveries') as index_count,
      (select relrowsecurity from pg_class where relname = 'partner_transfer_recoveries') as rls_on;
    `,
    "verify-table"
  );
  report.steps.push({ step: "verify", out: verify.slice(0, 2000) });

  const statuses = dbQuery(
    `
    select pg_get_constraintdef(oid) as def
    from pg_constraint
    where conrelid = 'public.partner_transfer_recoveries'::regclass
      and contype = 'c'
      and conname like '%status%';
    `,
    "verify-status-check"
  );
  if (!statuses.includes("recovery_required") || !statuses.includes("recovered")) {
    throw new Error(`status check missing expected values:\n${statuses}`);
  }

  report.ok = true;
  writeFileSync(join(BACKUP, "report.json"), JSON.stringify(report, null, 2));
  log("OK partner_transfer_recoveries applied");
  console.log(JSON.stringify({ ok: true, project: PROJECT_REF, version: MIG_VERSION, backup: BACKUP }, null, 2));
} catch (e) {
  report.ok = false;
  report.error = e instanceof Error ? e.message : String(e);
  writeFileSync(join(BACKUP, "report.json"), JSON.stringify(report, null, 2));
  console.error(report.error);
  process.exit(1);
}
