#!/usr/bin/env node
/**
 * Verify production cron endpoints respond (401 without secret, 2xx/4xx business with secret).
 *
 * Usage:
 *   CRON_SECRET=... node scripts/verify-production-crons.mjs
 *   CRON_SECRET=... PRODUCTION_SITE_URL=https://www.mmddelivery.com node scripts/verify-production-crons.mjs
 *
 * Also verifies GitHub Actions secret presence when GH_TOKEN / gh CLI is available:
 *   node scripts/verify-production-crons.mjs --check-github-secret
 *
 * Ops checklist (must be done once per environment):
 * 1. Set CRON_SECRET in Vercel Production env (same value for Preview if crons run there).
 * 2. Sync to GitHub Actions: node scripts/sync-github-cron-secret.mjs
 * 3. Re-run this script with CRON_SECRET set until all probes PASS.
 * 4. Confirm EXTERNAL_DISPATCH_CRON_CONFIGURED=true in local certification env after GH workflows succeed.
 */
const siteUrl = (process.env.PRODUCTION_SITE_URL || "https://www.mmddelivery.com").replace(/\/$/, "");
const cronSecret = String(process.env.CRON_SECRET || "").trim();
const checkGithub = process.argv.includes("--check-github-secret");

const vercelCrons = [
  { name: "process-payouts", path: "/api/admin/process-payouts", schedule: "Sun 03:00 UTC", money: true },
  { name: "expire-unpaid", path: "/api/orders/expire-unpaid", schedule: "Daily 05:00 UTC" },
  { name: "taxi-monitoring-snapshot", path: "/api/cron/taxi-monitoring-snapshot", schedule: "Daily 06:00 UTC" },
  { name: "vehicle-eligibility-refresh", path: "/api/cron/vehicle-eligibility-refresh", schedule: "Daily 00:05 UTC" },
];

const externalCrons = [
  { name: "retry-order-dispatch", path: "/api/cron/retry-order-dispatch" },
  { name: "retry-taxi-dispatch", path: "/api/cron/retry-taxi-dispatch" },
  { name: "retry-delivery-request-dispatch", path: "/api/cron/retry-delivery-request-dispatch" },
  { name: "taxi-scheduled-dispatch", path: "/api/cron/taxi-scheduled-dispatch" },
  { name: "taxi-active-ride-compliance", path: "/api/cron/taxi-active-ride-compliance", schedule: "GitHub Actions every 3 min" },
  { name: "ride-safety-recording-retention", path: "/api/cron/ride-safety-recording-retention", schedule: "GitHub Actions every 6 h" },
];

async function probe(path, authorized = false) {
  const headers = authorized && cronSecret
    ? { Authorization: `Bearer ${cronSecret}`, "x-cron-secret": cronSecret }
    : {};
  const res = await fetch(`${siteUrl}${path}`, {
    method: "POST",
    headers,
  });
  return res.status;
}

let failed = 0;

console.log(`Production cron probe — ${siteUrl}\n`);

if (!cronSecret) {
  console.log("FAIL CRON_SECRET is empty — production crons fail closed without it.");
  failed += 1;
}

async function probeCron(cron, label) {
  try {
    const schedule = "schedule" in cron && cron.schedule ? ` (${cron.schedule})` : "";
    const unauth = await probe(cron.path, false);
    const passUnauth = unauth === 401 || unauth === 405;
    console.log(`${passUnauth ? "PASS" : "FAIL"} [${label}] ${cron.name}${schedule} unauth=${unauth}`);
    if (!passUnauth) failed += 1;

    if (!cronSecret) {
      console.log(`SKIP [${label}] ${cron.name} authorized probe — set CRON_SECRET`);
      return;
    }

    if (cron.money && process.env.CERTIFICATION_ALLOW_PAYOUT_CRON !== "true") {
      console.log(
        `SKIP [${label}] ${cron.name} authorized money probe — set CERTIFICATION_ALLOW_PAYOUT_CRON=true to run`
      );
      return;
    }

    const auth = await probe(cron.path, true);
    // 401 with secret = wrong/missing secret on server (FAIL). 2xx/4xx business = auth accepted.
    const passAuth = auth !== 401 && auth !== 403 && auth < 500;
    console.log(`${passAuth ? "PASS" : "FAIL"} [${label}] ${cron.name} auth=${auth}`);
    if (!passAuth) failed += 1;
  } catch (error) {
    console.log(`FAIL [${label}] ${cron.name}`, error);
    failed += 1;
  }
}

for (const cron of vercelCrons) {
  await probeCron(cron, "vercel");
}

console.log("");

for (const cron of externalCrons) {
  await probeCron(cron, "external");
}

if (checkGithub) {
  console.log("\nGitHub Actions CRON_SECRET presence:");
  try {
    const { execSync } = await import("node:child_process");
    const out = execSync("gh secret list --json name", { encoding: "utf8" });
    const names = JSON.parse(out).map((row) => row.name);
    if (names.includes("CRON_SECRET")) {
      console.log("PASS GitHub Actions secret CRON_SECRET exists");
      console.log(
        "NOTE: Value parity with Vercel cannot be read back from GitHub; re-run scripts/sync-github-cron-secret.mjs after any Vercel rotation."
      );
    } else {
      console.log("FAIL GitHub Actions secret CRON_SECRET missing — run scripts/sync-github-cron-secret.mjs");
      failed += 1;
    }
  } catch (error) {
    console.log("WARN could not list GitHub secrets (install/auth gh CLI):", error.message || error);
  }
}

console.log(`\n${failed === 0 ? "ALL CHECKS PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed > 0 ? 1 : 0);
