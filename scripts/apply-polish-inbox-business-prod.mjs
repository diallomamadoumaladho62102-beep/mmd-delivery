#!/usr/bin/env node
/**
 * Apply notification inbox + business invites migrations to linked prod.
 * Idempotent. No destructive SQL. No Stripe/money movement.
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
const MIGRATIONS = [
  {
    version: "20261013120000",
    name: "notification_inbox_user_center",
  },
  {
    version: "20261013121000",
    name: "taxi_business_member_invites",
  },
];

const STAMP = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const BACKUP = join(ROOT, "backups", `supabase-${PROJECT_REF}-polish-inbox-${STAMP}`);
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
  if (ref !== PROJECT_REF) {
    throw new Error(`REFUSING linked=${ref} expected=${PROJECT_REF}`);
  }
  log(`linked_ref=${ref}`);
}

function safetyScan(sql) {
  if (/\b(delete\s+from|truncate|drop\s+table|drop\s+schema)\b/i.test(sql)) {
    throw new Error("REFUSING: destructive SQL detected");
  }
}

const report = { ok: false, backup: BACKUP, steps: [] };

try {
  assertLinked();

  for (const mig of MIGRATIONS) {
    const migFile = join(
      ROOT,
      "supabase",
      "migrations",
      `${mig.version}_${mig.name}.sql`,
    );
    if (!existsSync(migFile)) throw new Error(`missing ${migFile}`);
    const sql = readFileSync(migFile, "utf8");
    safetyScan(sql);
    copyFileSync(migFile, join(BACKUP, `${mig.version}.sql`));

    const alreadyOut = dbQuery(
      `select version from supabase_migrations.schema_migrations where version = '${mig.version}';`,
      `already-${mig.version}`,
    );
    const already = alreadyOut.includes(mig.version);
    report.steps.push({ step: "already_applied_check", version: mig.version, already });

    log(`APPLY ${mig.version}...`);
    const apply = npxSupabase(["db", "query", "--linked", "-f", migFile]);
    const applyOut = `${apply.stdout || ""}\n${apply.stderr || ""}`;
    writeFileSync(join(BACKUP, `apply-${mig.version}.txt`), applyOut, "utf8");
    if (apply.status !== 0) {
      throw new Error(`APPLY FAILED ${mig.version}\n${applyOut.slice(-6000)}`);
    }
    log(`APPLY_OK ${mig.version}`);

    if (!already) {
      dbQuery(
        `insert into supabase_migrations.schema_migrations (version, name)
         values ('${mig.version}', '${mig.name}')
         on conflict (version) do nothing;`,
        `record-${mig.version}`,
      );
    }
  }

  const verify = dbQuery(
    `
select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='notification_logs'
      and column_name in ('read_at','archived_at')) as notif_cols,
  (select to_regclass('public.taxi_business_member_invites') is not null) as invites_table,
  (select version from supabase_migrations.schema_migrations where version='20261013120000') as v1,
  (select version from supabase_migrations.schema_migrations where version='20261013121000') as v2;
`,
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
  writeFileSync(join(BACKUP, "FATAL.txt"), String(e?.stack || e), "utf8");
  console.error(String(e?.stack || e));
  process.exit(1);
}
