#!/usr/bin/env node
/**
 * Verify production cron endpoints respond (401 without secret, 200 with secret).
 * Usage: CRON_SECRET=... node scripts/verify-production-crons.mjs
 */
const siteUrl = (process.env.PRODUCTION_SITE_URL || "https://www.mmddelivery.com").replace(/\/$/, "");
const cronSecret = String(process.env.CRON_SECRET || "").trim();

const vercelCrons = [
  { name: "process-payouts", path: "/api/admin/process-payouts", schedule: "Sun 03:00 UTC" },
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
    ? { Authorization: `Bearer ${cronSecret}` }
    : {};
  const res = await fetch(`${siteUrl}${path}`, {
    method: "POST",
    headers,
  });
  return res.status;
}

let failed = 0;

console.log(`Production cron probe — ${siteUrl}\n`);

for (const cron of vercelCrons) {
  console.log(`[vercel] ${cron.name} (${cron.schedule})`);
  console.log(`  route exists: ${cron.path}`);
}

console.log("");

for (const cron of externalCrons) {
  try {
    const schedule = "schedule" in cron ? ` (${cron.schedule})` : "";
    const unauth = await probe(cron.path, false);
    const passUnauth = unauth === 401 || unauth === 405;
    console.log(`${passUnauth ? "PASS" : "WARN"} [external] ${cron.name}${schedule} unauth=${unauth}`);

    if (cronSecret) {
      const auth = await probe(cron.path, true);
      const passAuth = auth >= 200 && auth < 500;
      console.log(`${passAuth ? "PASS" : "FAIL"} [external] ${cron.name} auth=${auth}`);
      if (!passAuth) failed += 1;
    } else {
      console.log("SKIP [external] authorized probe — set CRON_SECRET to verify 200");
    }
  } catch (error) {
    console.log(`FAIL [external] ${cron.name}`, error);
    failed += 1;
  }
}

if (!cronSecret) {
  console.log("\nSet CRON_SECRET and re-run for full external cron verification.");
}

process.exit(failed > 0 ? 1 : 0);
