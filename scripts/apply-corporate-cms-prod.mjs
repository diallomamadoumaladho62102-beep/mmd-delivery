#!/usr/bin/env node
/**
 * Apply 20261014120000_mmd_corporate_cms.sql to linked prod.
 * Idempotent. No Stripe/money movement.
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
const MIG_VERSION = "20261014120000";
const MIG_NAME = "mmd_corporate_cms";
const MIG_FILE = join(ROOT, "supabase", "migrations", `${MIG_VERSION}_${MIG_NAME}.sql`);
const STAMP = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const BACKUP = join(ROOT, "backups", `supabase-${PROJECT_REF}-corporate-cms-${STAMP}`);
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
    throw new Error(`db query failed (${label}): exit ${r.status}\n${out.slice(-4000)}`);
  }
  return out;
}

function assertLinked() {
  const refPath = join(ROOT, "supabase", ".temp", "project-ref");
  if (!existsSync(refPath)) throw new Error("missing supabase/.temp/project-ref");
  const ref = readFileSync(refPath, "utf8").trim();
  if (ref !== PROJECT_REF) throw new Error(`REFUSING linked=${ref}`);
  log(`linked_ref=${ref}`);
}

const report = { ok: false, backup: BACKUP, version: MIG_VERSION, steps: [] };

try {
  assertLinked();
  if (!existsSync(MIG_FILE)) throw new Error(`missing ${MIG_FILE}`);
  const sql = readFileSync(MIG_FILE, "utf8");
  if (/\b(truncate|drop\s+table|drop\s+schema)\b/i.test(sql)) {
    throw new Error("REFUSING destructive SQL");
  }
  copyFileSync(MIG_FILE, join(BACKUP, "migration.sql"));

  const already = dbQuery(
    `select version from supabase_migrations.schema_migrations where version='${MIG_VERSION}';`,
    "already",
  ).includes(MIG_VERSION);
  report.steps.push({ already });

  log("APPLY...");
  const apply = npxSupabase(["db", "query", "--linked", "-f", MIG_FILE]);
  const applyOut = `${apply.stdout || ""}\n${apply.stderr || ""}`;
  writeFileSync(join(BACKUP, "apply.txt"), applyOut, "utf8");
  if (apply.status !== 0) throw new Error(`APPLY FAILED\n${applyOut.slice(-6000)}`);
  log("APPLY_OK");

  if (!already) {
    dbQuery(
      `insert into supabase_migrations.schema_migrations (version, name)
       values ('${MIG_VERSION}', '${MIG_NAME}') on conflict (version) do nothing;`,
      "record",
    );
  }

  const verify = dbQuery(
    `select
      (select to_regclass('public.site_pages') is not null) as pages,
      (select to_regclass('public.site_page_blocks') is not null) as blocks,
      (select count(*) from public.site_pages where locale='en') as page_count,
      (select version from supabase_migrations.schema_migrations where version='${MIG_VERSION}') as ver;`,
    "verify",
  );
  writeFileSync(join(BACKUP, "VERIFY.txt"), verify, "utf8");
  report.verify = verify;
  report.ok = true;
  writeFileSync(join(BACKUP, "FINAL.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, backup: BACKUP }, null, 2));
} catch (e) {
  report.ok = false;
  report.error = String(e?.stack || e);
  writeFileSync(join(BACKUP, "FINAL.json"), JSON.stringify(report, null, 2));
  console.error(String(e?.stack || e));
  process.exit(1);
}
