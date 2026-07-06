#!/usr/bin/env node
/**
 * Production post-deploy verification harness.
 * Requires: CRON_SECRET (optional, for authorized cron probes)
 */
const siteUrl = (process.env.PRODUCTION_SITE_URL || "https://www.mmddelivery.com").replace(/\/$/, "");
const cronSecret = String(process.env.CRON_SECRET || "").trim();

const routes = [
  { group: "health", path: "/api/health", method: "GET", expectUnauth: [200, 401] },
  { group: "cron", path: "/api/cron/retry-order-dispatch", method: "POST", expectUnauth: [401] },
  { group: "cron", path: "/api/cron/retry-taxi-dispatch", method: "POST", expectUnauth: [401] },
  { group: "cron", path: "/api/cron/retry-delivery-request-dispatch", method: "POST", expectUnauth: [401] },
  { group: "cron", path: "/api/cron/taxi-scheduled-dispatch", method: "POST", expectUnauth: [401] },
  { group: "cron", path: "/api/cron/taxi-active-ride-compliance", method: "POST", expectUnauth: [401] },
  { group: "cron", path: "/api/cron/vehicle-eligibility-refresh", method: "POST", expectUnauth: [401] },
  { group: "cron", path: "/api/cron/ride-safety-recording-retention", method: "POST", expectUnauth: [401] },
  { group: "cron", path: "/api/orders/expire-unpaid", method: "POST", expectUnauth: [401] },
  { group: "security", path: "/api/stripe/webhook", method: "POST", expectUnauth: [400, 401, 403] },
];

async function probe(route, authorized = false) {
  const headers = { "Content-Type": "application/json" };
  if (authorized && cronSecret) {
    headers.Authorization = `Bearer ${cronSecret}`;
  }
  const res = await fetch(`${siteUrl}${route.path}`, {
    method: route.method,
    headers,
    body: route.method === "POST" ? "{}" : undefined,
  });
  return res.status;
}

const results = [];
let failed = 0;

console.log(`Production route verification — ${siteUrl}\n`);

for (const route of routes) {
  try {
    const unauth = await probe(route, false);
    const unauthOk = route.expectUnauth.includes(unauth);
    results.push({ route: route.path, probe: "unauth", status: unauth, ok: unauthOk });
    console.log(`${unauthOk ? "PASS" : "FAIL"} ${route.path} unauth=${unauth}`);

    if (!unauthOk) failed += 1;

    if (route.group === "cron" && cronSecret) {
      const auth = await probe(route, true);
      const authOk = auth >= 200 && auth < 500;
      results.push({ route: route.path, probe: "auth", status: auth, ok: authOk });
      console.log(`${authOk ? "PASS" : "FAIL"} ${route.path} auth=${auth}`);
      if (!authOk) failed += 1;
    }
  } catch (error) {
    console.log(`FAIL ${route.path}`, error);
    failed += 1;
  }
}

if (!cronSecret) {
  console.log("\nSet CRON_SECRET for authorized cron probes (expect 200).");
}

console.log(`\nSummary: ${results.filter((r) => r.ok).length}/${results.length} checks passed`);
process.exit(failed > 0 ? 1 : 0);
