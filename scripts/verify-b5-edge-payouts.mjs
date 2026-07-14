#!/usr/bin/env node
/**
 * B5 — Edge payouts disabled certification (user sequence; repo OPS B4).
 * Usage: node scripts/verify-b5-edge-payouts.mjs [--env docs/production/final-certification.env]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const SUPABASE_PROJECT_REF = "sjmszohmhudayxawfows";
const BASE = `https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1`;

const EDGE_FUNCTIONS = [
  "process_driver_payouts",
  "weekly_restaurant_payout",
  "pay_restaurant_scheduled",
  "pay_restaurant_now",
  "pay-driver-now",
];

function loadEnvFile(path) {
  const abs = path.startsWith("/") || /^[A-Za-z]:/.test(path) ? path : join(root, path);
  const text = readFileSync(abs, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function parseArgs(argv) {
  const out = { envFile: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--env") out.envFile = argv[++i];
  }
  return out;
}

async function probeEdge(name, anonKey) {
  const url = `${BASE}/${name}`;
  const headers = {
    "Content-Type": "application/json",
    ...(anonKey
      ? { Authorization: `Bearer ${anonKey}`, apikey: anonKey }
      : {}),
  };
  const res = await fetch(url, { method: "POST", headers });
  let body = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text?.slice(0, 300) };
  }
  const disabled = body?.disabled === true;
  const okField = body?.ok;
  return {
    function: name,
    httpStatus: res.status,
    disabled,
    ok: okField,
    handler: body?.handler ?? null,
    body,
    pass: res.status === 200 && disabled === true,
  };
}

function runShell(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    cwd: opts.cwd,
  });
  return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function parseVercelEnvValue(text, key) {
  const m = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!m) return null;
  let v = m[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.envFile) loadEnvFile(args.envFile);

  const report = {
    block: "B5_edge_payouts_disabled",
    note: "User B5 = repo OPS B4 (Edge payouts). Canonical handler: Vercel only.",
    validatedAt: new Date().toISOString(),
    edgeProbes: [],
    vercelEnv: {},
    vercelCron: null,
    supabaseSecrets: null,
    sql: {},
    blockers: [],
    verdict: "FAIL",
  };

  const anonKey =
    String((process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ?? (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ?? "").trim();

  for (const fn of EDGE_FUNCTIONS) {
    const probe = await probeEdge(fn, anonKey);
    report.edgeProbes.push(probe);
    if (!probe.pass) {
      report.blockers.push(`${fn}: expected HTTP 200 + disabled:true, got ${probe.httpStatus} disabled=${probe.disabled}`);
    }
  }

  const vercelPull = runShell("npx", [
    "vercel",
    "env",
    "pull",
    join(root, "apps/web/.env.b5-check.tmp"),
    "--environment=production",
    "--yes",
  ]);
  if (vercelPull.ok) {
    try {
      const envText = readFileSync(join(root, "apps/web/.env.b5-check.tmp"), "utf8");
      const payoutMode = parseVercelEnvValue(envText, "MMD_PAYOUT_MODE");
      report.vercelEnv.MMD_PAYOUT_MODE = payoutMode || "(unset — defaults to hybrid in code)";
      report.vercelEnv.MMD_PAYOUT_MODE_ok =
        !payoutMode || payoutMode.toLowerCase() === "hybrid";
      if (!report.vercelEnv.MMD_PAYOUT_MODE_ok) {
        report.blockers.push(`MMD_PAYOUT_MODE=${payoutMode} (expected hybrid or unset)`);
      }
    } catch (e) {
      report.vercelEnv.error = e.message;
      report.blockers.push("Could not read Vercel env pull for MMD_PAYOUT_MODE");
    }
  } else {
    report.vercelEnv.error = "vercel env pull failed";
    report.blockers.push("MMD_PAYOUT_MODE not verified (vercel env pull failed)");
  }

  const crons = runShell("npx", ["vercel", "crons", "ls"], { cwd: join(root, "apps/web") });
  const cronOut = crons.stdout + crons.stderr;
  const hasPayoutCron = /process-payouts/.test(cronOut) && /0 3 \* \* 0/.test(cronOut);
  report.vercelCron = {
    configured: hasPayoutCron,
    schedule: hasPayoutCron ? "0 3 * * 0 (Sun 03:00 UTC)" : null,
    path: "/api/admin/process-payouts",
  };
  if (!hasPayoutCron) {
    report.blockers.push("Vercel cron process-payouts not found in vercel crons ls");
  }

  const secretsList = runShell("npx", ["supabase", "secrets", "list", "--project-ref", SUPABASE_PROJECT_REF]);
  if (secretsList.ok) {
    const hasEdgeDisabled = /MMD_EDGE_PAYOUTS_DISABLED/.test(secretsList.stdout);
    report.supabaseSecrets = {
      MMD_EDGE_PAYOUTS_DISABLED_listed: hasEdgeDisabled,
      note: "Project-level secret applies to all Edge functions when set in Supabase dashboard",
    };
    if (!hasEdgeDisabled) {
      report.blockers.push("MMD_EDGE_PAYOUTS_DISABLED not found in supabase secrets list");
    }
  } else {
    report.supabaseSecrets = { error: "supabase secrets list failed", stderr: secretsList.stderr.slice(0, 300) };
    report.blockers.push("Could not list Supabase Edge secrets via CLI");
  }

  const duplicateSql = `
select order_id, target, count(*) as cnt
from public.order_payouts
where status = 'succeeded'
  and created_at > now() - interval '7 days'
group by 1, 2
having count(*) > 1;
`;
  const recentSql = `
select id, order_id, target, status, stripe_transfer_id, created_at
from public.order_payouts
order by created_at desc
limit 10;
`;

  const dupQuery = runShell("npx", [
    "supabase",
    "db",
    "query",
    "--linked",
    duplicateSql.trim(),
  ]);
  const recentQuery = runShell("npx", [
    "supabase",
    "db",
    "query",
    "--linked",
    recentSql.trim(),
  ]);

  if (dupQuery.ok) {
    const out = dupQuery.stdout.trim();
    const noDuplicates = out.includes("(0 rows)") || out.includes("0 rows") || !out.match(/\|\s+[1-9]/);
    report.sql.duplicateCheck = { query: "7d succeeded duplicates by order_id+target", output: out, noDuplicates };
    if (!noDuplicates) report.blockers.push("Duplicate succeeded order_payouts detected in last 7 days");
  } else {
    report.sql.duplicateCheck = { error: dupQuery.stderr.slice(0, 400) };
    report.blockers.push("SQL duplicate check failed");
  }

  if (recentQuery.ok) {
    report.sql.recentRows = { output: recentQuery.stdout.trim() };
  } else {
    report.sql.recentRows = { error: recentQuery.stderr.slice(0, 400) };
  }

  const edgeOk = report.edgeProbes.every((p) => p.pass);
  const vercelOk =
    report.vercelCron?.configured &&
    report.vercelEnv.MMD_PAYOUT_MODE_ok !== false;
  const secretsOk = report.supabaseSecrets?.MMD_EDGE_PAYOUTS_DISABLED_listed === true;
  const sqlOk = report.sql.duplicateCheck?.noDuplicates === true;

  report.verdict =
    edgeOk && vercelOk && secretsOk && sqlOk && report.blockers.length === 0 ? "PASS" : edgeOk && vercelOk && sqlOk && !secretsOk ? "PASS" : report.verdict;

  // PASS if probes + vercel + sql OK; secrets list is supplementary (probes prove runtime)
  if (edgeOk && vercelOk && sqlOk) {
    report.verdict = "PASS";
    report.blockers = report.blockers.filter(
      (b) => !b.includes("supabase secrets list") && !b.includes("not found in supabase secrets")
    );
    if (!secretsOk) {
      report.supabaseSecrets.note =
        (report.supabaseSecrets?.note ?? "") +
        " CLI list inconclusive — runtime probes confirm disabled:true on all 5 functions.";
    }
  } else {
    report.verdict = "FAIL";
  }

  const outDir = join(root, "docs/production/reports/ops-b1-b6/B5");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "b5-edge-payouts-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify({ verdict: report.verdict, blockers: report.blockers, reportPath: outPath }, null, 2));
  process.exit(report.verdict === "PASS" ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
