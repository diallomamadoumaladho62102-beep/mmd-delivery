#!/usr/bin/env node
/**
 * Create or update MMD dispatch cron jobs on cron-job.org (REST API).
 *
 * Requires (never commit):
 *   CRONJOB_API_KEY  — cron-job.org → Settings → API key
 *   CRON_SECRET      — Vercel Production (Bearer for MMD endpoints)
 *
 * Usage:
 *   cd apps/web && npx vercel env run -e production -- node ../../scripts/setup-cron-job-dispatch.mjs
 *   CRONJOB_API_KEY=... node scripts/setup-cron-job-dispatch.mjs --env docs/production/final-certification.env
 *   node scripts/setup-cron-job-dispatch.mjs --dry-run
 *
 * Note: apps/web/.env.vercel.production.local masks Encrypted CRON_SECRET — use vercel env run.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const API = "https://api.cron-job.org";
const BASE_URL = "https://www.mmddelivery.com";

const JOBS = [
  {
    title: "MMD retry-order-dispatch",
    path: "/api/cron/retry-order-dispatch",
    intervalMinutes: 3,
  },
  {
    title: "MMD retry-taxi-dispatch",
    path: "/api/cron/retry-taxi-dispatch",
    intervalMinutes: 3,
  },
  {
    title: "MMD taxi-scheduled-dispatch",
    path: "/api/cron/taxi-scheduled-dispatch",
    intervalMinutes: 2,
  },
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
    if (key === "CRON_SECRET" && String(val).includes("change-moi")) continue;
    if (!process.env[key]) process.env[key] = val;
  }
}

function everyNMinutes(n) {
  const minutes = [];
  for (let m = 0; m < 60; m += n) minutes.push(m);
  return minutes;
}

function buildJobPayload(def, cronSecret) {
  const url = `${BASE_URL}${def.path}`;
  return {
    title: def.title,
    url,
    enabled: true,
    saveResponses: true,
    requestTimeout: 60,
    redirectSuccess: false,
    requestMethod: 0,
    schedule: {
      timezone: "UTC",
      expiresAt: 0,
      hours: [-1],
      mdays: [-1],
      months: [-1],
      wdays: [-1],
      minutes: everyNMinutes(def.intervalMinutes),
    },
    notification: {
      onFailure: true,
      onFailureCount: 2,
      onSuccess: false,
      onDisable: true,
      onSslCertExpiry: true,
      onSslCertExpirySeconds: 604800,
    },
    extendedData: {
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        Accept: "application/json",
      },
    },
  };
}

async function api(method, path, apiKey, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`cron-job.org ${method} ${path} → HTTP ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

function parseArgs(argv) {
  const out = { dryRun: false, envFiles: [] };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--env" || arg === "--vercel-env") {
      const next = argv[++i];
      if (next) out.envFiles.push(next);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  for (const file of args.envFiles) loadEnvFile(file);

  const apiKey = String(process.env.CRONJOB_API_KEY ?? "").trim();
  const cronSecret = String(process.env.CRON_SECRET ?? "").trim();

  if (!apiKey) {
    console.error("Missing CRONJOB_API_KEY.");
    console.error("Get it at https://console.cron-job.org/settings → API key.");
    process.exit(1);
  }
  if (!cronSecret) {
    console.error("Missing CRON_SECRET (Vercel Production).");
    console.error("Use --vercel-env apps/web/.env.vercel.production.local or --env docs/production/final-certification.env");
    process.exit(1);
  }

  if (args.dryRun) {
    console.log("Dry run — would create/update:");
    for (const def of JOBS) {
      const payload = buildJobPayload(def, cronSecret);
      console.log(`- ${def.title}`);
      console.log(`  URL: ${payload.url}`);
      console.log(`  Every ${def.intervalMinutes} min (UTC)`);
      console.log(`  Timeout: ${payload.requestTimeout}s`);
      console.log(`  Method: GET`);
      console.log(`  Header: Authorization: Bearer ***`);
    }
    process.exit(0);
  }

  const listed = await api("GET", "/jobs", apiKey);
  const existing = new Map(
    (listed.jobs ?? [])
      .filter((j) => typeof j.url === "string" && j.url.includes("mmddelivery.com/api/cron/"))
      .map((j) => [j.url.replace(/\/$/, ""), j])
  );

  const results = [];
  for (const def of JOBS) {
    const url = `${BASE_URL}${def.path}`;
    const payload = buildJobPayload(def, cronSecret);
    const found = existing.get(url);

    if (found?.jobId) {
      await api("PATCH", `/jobs/${found.jobId}`, apiKey, { job: payload });
      results.push({ action: "updated", jobId: found.jobId, title: def.title, url });
    } else {
      const created = await api("PUT", "/jobs", apiKey, { job: payload });
      results.push({ action: "created", jobId: created.jobId, title: def.title, url });
      await new Promise((r) => setTimeout(r, 1100));
    }
  }

  console.log(JSON.stringify({ ok: true, results }, null, 2));

  const certPath = join(root, "docs/production/final-certification.env");
  try {
    let cert = readFileSync(certPath, "utf8");
    if (/^EXTERNAL_DISPATCH_CRON_CONFIGURED=/m.test(cert)) {
      cert = cert.replace(/^EXTERNAL_DISPATCH_CRON_CONFIGURED=.*$/m, "EXTERNAL_DISPATCH_CRON_CONFIGURED=true");
    } else {
      cert += `\nEXTERNAL_DISPATCH_CRON_CONFIGURED=true\n`;
    }
    writeFileSync(certPath, cert, "utf8");
    console.log("Set EXTERNAL_DISPATCH_CRON_CONFIGURED=true in final-certification.env");
  } catch {
    console.log("Tip: set EXTERNAL_DISPATCH_CRON_CONFIGURED=true in final-certification.env after verifying runs.");
  }
}

main().catch((err) => {
  console.error(err.message);
  if (err.body) console.error(JSON.stringify(err.body, null, 2));
  process.exit(1);
});
