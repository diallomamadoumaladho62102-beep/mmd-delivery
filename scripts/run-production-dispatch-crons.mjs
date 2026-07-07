#!/usr/bin/env node
/**
 * Invoke production dispatch cron routes (used by GitHub Actions workflow).
 */
const siteUrl = String(
  process.env.SITE_URL || process.env.PRODUCTION_SITE_URL || "https://www.mmddelivery.com",
)
  .trim()
  .replace(/\/$/, "");
const cronSecret = String(process.env.CRON_SECRET ?? "").trim();

const cronPaths = [
  "/api/cron/retry-order-dispatch",
  "/api/cron/retry-taxi-dispatch",
  "/api/cron/retry-delivery-request-dispatch",
  "/api/cron/taxi-scheduled-dispatch",
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!cronSecret) {
  fail(
    "CRON_SECRET is missing. Add repository secret CRON_SECRET in GitHub Actions (same value as Vercel production).",
  );
}

async function invokeCron(path) {
  const url = `${siteUrl}${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cronSecret}`,
      "Content-Type": "application/json",
    },
  });

  const bodyText = await response.text();
  let bodyPreview = bodyText.trim();
  if (bodyPreview.length > 300) {
    bodyPreview = `${bodyPreview.slice(0, 300)}...`;
  }

  console.log(`${path} -> HTTP ${response.status}${bodyPreview ? ` ${bodyPreview}` : ""}`);

  if (response.status === 401) {
    fail(
      `${path} returned 401 Unauthorized. CRON_SECRET in GitHub Actions does not match Vercel production.`,
    );
  }

  if (response.status === 404) {
    fail(`${path} returned 404. Check SITE_URL (${siteUrl}) and Vercel deployment.`);
  }

  if (response.status >= 500) {
    fail(`${path} returned HTTP ${response.status}. Inspect Vercel production logs.`);
  }

  if (!response.ok) {
    fail(`${path} returned HTTP ${response.status}.`);
  }
}

async function main() {
  console.log(`Production dispatch crons — ${siteUrl}`);
  for (const path of cronPaths) {
    await invokeCron(path);
  }
  console.log("All production dispatch crons succeeded.");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
