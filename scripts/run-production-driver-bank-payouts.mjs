#!/usr/bin/env node
/**
 * Invoke production driver Connect → bank payout cron
 * (Sunday 04:00 America/New_York via dual GH schedules).
 */
import { evaluateCronHttpResult } from "./lib/evaluateCronHttpResult.mjs";

const siteUrl = String(
  process.env.SITE_URL || process.env.PRODUCTION_SITE_URL || "https://www.mmddelivery.com",
)
  .trim()
  .replace(/\/$/, "");
const cronSecret = String(process.env.CRON_SECRET ?? "").trim();
const fetchTimeoutMs = Math.max(
  5_000,
  Number(process.env.CRON_FETCH_TIMEOUT_MS ?? 90_000) || 90_000,
);

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!cronSecret) {
  fail("CRON_SECRET is missing.");
}

const qs = new URLSearchParams();
if (process.env.FORCE === "1" || process.env.FORCE === "true") qs.set("force", "1");
if (process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true") {
  qs.set("dry_run", "1");
}
if (process.env.SCHEDULE_ONLY === "1" || process.env.SCHEDULE_ONLY === "true") {
  qs.set("schedule_only", "1");
  qs.set("force", "1");
}
const query = qs.toString();
const path = `/api/cron/driver-connect-bank-payouts${query ? `?${query}` : ""}`;

async function main() {
  const url = `${siteUrl}${path}`;
  console.log(`Driver bank payouts — ${url}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
  let response;
  let bodyText = "";
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    bodyText = await response.text();
  } catch (error) {
    clearTimeout(timer);
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }

  let bodyPreview = bodyText.trim();
  if (bodyPreview.length > 500) bodyPreview = `${bodyPreview.slice(0, 500)}...`;
  console.log(`HTTP ${response.status} ${bodyPreview}`);

  const evaluated = evaluateCronHttpResult(response.status, bodyText);
  if (!evaluated.ok) {
    fail(`driver bank payout cron failed (${evaluated.reason}).`);
  }

  // Outside the Sunday 4am ET window is a successful no-op (expected for the off-DST schedule fire).
  console.log("Driver bank payout cron completed.");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
