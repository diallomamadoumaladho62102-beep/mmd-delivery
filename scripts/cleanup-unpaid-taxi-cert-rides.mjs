#!/usr/bin/env node
/**
 * Cancel unpaid certification / leftover taxi rides via linked Supabase SQL.
 * Dry-run by default. APPLY=1 to mutate. Never touches paid rides.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const APPLY = process.env.APPLY === "1";
const ROOT = process.cwd();
const PROJECT_REF = "sjmszohmhudayxawfows";
const STAMP = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const OUT = join(ROOT, "backups", `taxi-unpaid-cleanup-${STAMP}`);
mkdirSync(OUT, { recursive: true });

function npxSupabase(args) {
  return spawnSync("npx", ["--yes", "supabase@latest", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    shell: true,
  });
}

function assertLinked() {
  const refPath = join(ROOT, "supabase", ".temp", "project-ref");
  if (!existsSync(refPath)) throw new Error("missing supabase/.temp/project-ref");
  const ref = readFileSync(refPath, "utf8").trim();
  if (ref !== PROJECT_REF) {
    throw new Error(`REFUSING linked=${ref} expected=${PROJECT_REF}`);
  }
}

function dbQuery(sql, label) {
  const sqlPath = join(OUT, `q-${label}.sql`);
  writeFileSync(sqlPath, sql, "utf8");
  const r = npxSupabase(["db", "query", "--linked", "-f", sqlPath]);
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  writeFileSync(join(OUT, `q-${label}.out.txt`), out, "utf8");
  if (r.status !== 0) {
    throw new Error(`db query failed (${label}): exit ${r.status}\n${out.slice(-4000)}`);
  }
  return out;
}

assertLinked();

const inventorySql = `
select id, payment_status, status, total_cents, stripe_payment_intent_id, created_at
from public.taxi_rides
where lower(coalesce(payment_status, '')) in ('unpaid', 'pending', 'pending_payment', 'processing')
  and lower(coalesce(status, '')) not in ('canceled', 'cancelled', 'completed', 'completed_paid')
order by created_at desc
limit 200;
`;

const inventory = dbQuery(inventorySql, "inventory");
writeFileSync(join(OUT, "INVENTORY.txt"), inventory, "utf8");
console.log(inventory);

if (!APPLY) {
  console.log(JSON.stringify({ ok: true, apply: false, out: OUT, note: "dry-run" }, null, 2));
  console.log("Re-run with APPLY=1 to cancel unpaid open rides (never paid).");
  process.exit(0);
}

const cancelSql = `
with targets as (
  select id
  from public.taxi_rides
  where lower(coalesce(payment_status, '')) in ('unpaid', 'pending', 'pending_payment', 'processing')
    and stripe_payment_intent_id is null
    and lower(coalesce(status, '')) in ('quoted', 'requested', 'searching', 'pending', 'unpaid', 'pending_payment')
)
update public.taxi_rides t
set
  status = 'canceled',
  cancel_reason = 'cert_cleanup_unpaid_pre_pay_then_create',
  updated_at = now()
from targets
where t.id = targets.id
  and lower(coalesce(t.payment_status, '')) in ('unpaid', 'pending', 'pending_payment', 'processing')
returning t.id, t.payment_status, t.status, t.cancel_reason;
`;

const canceled = dbQuery(cancelSql, "cancel");
writeFileSync(join(OUT, "CANCELED.txt"), canceled, "utf8");
console.log(canceled);
console.log(JSON.stringify({ ok: true, apply: true, out: OUT }, null, 2));
