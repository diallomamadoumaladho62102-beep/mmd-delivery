#!/usr/bin/env node
/**
 * B4 — Dispatch cron certification (production probes + optional cron-job.org check).
 *
 * Usage:
 *   node scripts/verify-b4-dispatch-cron.mjs --env docs/production/final-certification.env
 *   node scripts/verify-b4-dispatch-cron.mjs --vercel-env apps/web/.env.vercel.production.local
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const API = "https://api.cron-job.org";
const BASE_URL = "https://www.mmddelivery.com";

const DISPATCH_PATHS = [
  "/api/cron/retry-order-dispatch",
  "/api/cron/retry-taxi-dispatch",
  "/api/cron/taxi-scheduled-dispatch",
];

const EXPECTED_JOBS = [
  { path: "/api/cron/retry-order-dispatch", intervalMinutes: 3 },
  { path: "/api/cron/retry-taxi-dispatch", intervalMinutes: 3 },
  { path: "/api/cron/taxi-scheduled-dispatch", intervalMinutes: 2 },
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
    process.env[key] = val;
  }
}

function parseArgs(argv) {
  const out = { envFiles: [], syncCronSecret: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--env" || arg === "--vercel-env") {
      const next = argv[++i];
      if (next) out.envFiles.push(next);
    } else if (arg === "--sync-cron-secret") out.syncCronSecret = true;
  }
  return out;
}

function syncCronSecretFromVercelPull(vercelEnvPath, certEnvPath) {
  const vercelAbs = vercelEnvPath.startsWith("/") || /^[A-Za-z]:/.test(vercelEnvPath)
    ? vercelEnvPath
    : join(root, vercelEnvPath);
  const certAbs = certEnvPath.startsWith("/") || /^[A-Za-z]:/.test(certEnvPath)
    ? certEnvPath
    : join(root, certEnvPath);
  const parse = (text) => {
    const out = {};
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i <= 0) continue;
      out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
    return out;
  };
  const vercel = parse(readFileSync(vercelAbs, "utf8"));
  const secret = String(vercel.CRON_SECRET ?? "").trim();
  if (!secret) return false;
  let cert = readFileSync(certAbs, "utf8");
  if (/^CRON_SECRET=/m.test(cert)) {
    cert = cert.replace(/^CRON_SECRET=.*$/m, `CRON_SECRET=${secret}`);
  } else {
    cert += `\nCRON_SECRET=${secret}\n`;
  }
  writeFileSync(certAbs, cert, "utf8");
  process.env.CRON_SECRET = secret;
  return true;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  let body = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text?.slice(0, 500) };
  }
  return { res, body };
}

async function checkEndpoint(path, cronSecret) {
  const url = `${BASE_URL}${path}`;
  const unauth = await fetchJson(url);
  const authed = await fetchJson(url, {
    headers: { Authorization: `Bearer ${cronSecret}`, Accept: "application/json" },
  });
  return {
    path,
    withoutAuth: { status: unauth.res.status },
    withAuth: { status: authed.res.status, ok: authed.body?.ok ?? null, body: authed.body },
  };
}

async function checkCronJobOrg(apiKey) {
  const res = await fetch(`${API}/jobs`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status}`, jobs: [] };
  }
  const data = await res.json();
  const now = Math.floor(Date.now() / 1000);
  const maxAgeSec = 15 * 60;

  const jobs = EXPECTED_JOBS.map((expected) => {
    const url = `${BASE_URL}${expected.path}`;
    const match = (data.jobs ?? []).find((j) => j.url === url || j.url === `${url}/`);
    if (!match) {
      return { path: expected.path, found: false };
    }
    const recent =
      match.lastExecution > 0 && now - match.lastExecution <= maxAgeSec && match.lastStatus === 1;
    return {
      path: expected.path,
      found: true,
      jobId: match.jobId,
      enabled: match.enabled,
      lastStatus: match.lastStatus,
      lastExecution: match.lastExecution,
      nextExecution: match.nextExecution,
      recentOk: recent,
    };
  });

  return {
    ok: jobs.every((j) => j.found && j.enabled && j.recentOk),
    jobs,
    note: "lastStatus=1 means HTTP 200 OK on last run",
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const vercelEnv = args.envFiles.find((f) => f.includes("vercel"));
  const certEnv = args.envFiles.find((f) => f.includes("final-certification")) ?? "docs/production/final-certification.env";

  if (args.syncCronSecret && vercelEnv) {
    syncCronSecretFromVercelPull(vercelEnv, certEnv);
  }

  for (const file of args.envFiles) loadEnvFile(file);
  if (!process.env.CRON_SECRET?.trim() && vercelEnv) {
    loadEnvFile(vercelEnv);
  }

  const cronSecret = String(process.env.CRON_SECRET ?? "").trim();
  const cronJobApiKey = String(process.env.CRONJOB_API_KEY ?? "").trim();
  const externalFlag = String(process.env.EXTERNAL_DISPATCH_CRON_CONFIGURED ?? "").toLowerCase() === "true";

  const report = {
    block: "B4_dispatch_crons",
    validatedAt: new Date().toISOString(),
    vercelJsonModified: false,
    blockers: [],
    endpointProbes: [],
    externalScheduler: null,
    verdict: "FAIL",
  };

  for (const path of DISPATCH_PATHS) {
    if (!cronSecret) {
      report.endpointProbes.push({ path, skip: true, reason: "CRON_SECRET not loaded" });
      report.blockers.push(`Cannot probe ${path} — missing CRON_SECRET locally`);
      continue;
    }
    const probe = await checkEndpoint(path, cronSecret);
    report.endpointProbes.push(probe);
    if (probe.withoutAuth.status !== 401) {
      report.blockers.push(`${path}: expected 401 without auth, got ${probe.withoutAuth.status}`);
    }
    if (probe.withAuth.status !== 200) {
      report.blockers.push(`${path}: expected 200 with Bearer, got ${probe.withAuth.status}`);
    }
  }

  if (cronJobApiKey) {
    report.externalScheduler = await checkCronJobOrg(cronJobApiKey);
    if (!report.externalScheduler.ok) {
      report.blockers.push("cron-job.org: missing jobs, disabled, or no successful run in last 15 min");
    }
  } else if (externalFlag) {
    report.externalScheduler = {
      ok: true,
      verifiedBy: "EXTERNAL_DISPATCH_CRON_CONFIGURED sign-off (cron-job.org manual ops)",
      note: "Set CRONJOB_API_KEY for automated cron-job.org API verification",
    };
  } else {
    report.externalScheduler = {
      ok: false,
      skipped: true,
      reason: "CRONJOB_API_KEY not available — set EXTERNAL_DISPATCH_CRON_CONFIGURED=true after cron-job.org sign-off",
    };
    report.blockers.push("External scheduler not verified (no CRONJOB_API_KEY or sign-off flag)");
  }

  const endpointsOk =
    cronSecret &&
    report.endpointProbes.length === DISPATCH_PATHS.length &&
    report.endpointProbes.every((p) => p.withoutAuth?.status === 401 && p.withAuth?.status === 200);

  const externalOk = report.externalScheduler?.ok === true;

  report.verdict = endpointsOk && externalOk ? "PASS" : "FAIL";

  const outDir = join(root, "docs/production/reports/ops-b1-b6/B4");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "b4-dispatch-cron-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify({ verdict: report.verdict, blockers: report.blockers, reportPath: outPath }, null, 2));
  process.exit(report.verdict === "PASS" ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
