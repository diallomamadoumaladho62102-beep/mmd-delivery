#!/usr/bin/env node
/**
 * Invoke production safety recording retention cron (GitHub Actions, every 6 h).
 */
const siteUrl = String(
  process.env.SITE_URL || process.env.PRODUCTION_SITE_URL || "https://www.mmddelivery.com",
)
  .trim()
  .replace(/\/$/, "");
const cronSecret = String(process.env.CRON_SECRET ?? "").trim();
const cronPath = "/api/cron/ride-safety-recording-retention";

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!cronSecret) {
  fail(
    "CRON_SECRET is missing. Add repository secret CRON_SECRET in GitHub Actions (same value as Vercel production).",
  );
}

async function main() {
  const url = `${siteUrl}${cronPath}`;
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

  console.log(`${cronPath} -> HTTP ${response.status}${bodyPreview ? ` ${bodyPreview}` : ""}`);

  if (response.status === 401) {
    fail(
      `${cronPath} returned 401 Unauthorized. CRON_SECRET in GitHub Actions does not match Vercel production.`,
    );
  }

  if (response.status === 404) {
    fail(`${cronPath} returned 404. Check SITE_URL (${siteUrl}) and Vercel deployment.`);
  }

  if (response.status >= 500) {
    fail(`${cronPath} returned HTTP ${response.status}. Inspect Vercel production logs.`);
  }

  if (!response.ok) {
    fail(`${cronPath} returned HTTP ${response.status}.`);
  }

  console.log("Safety recording retention cron succeeded.");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
