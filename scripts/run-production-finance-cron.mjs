#!/usr/bin/env node
/**
 * Invoke production /api/cron/process-finance (hourly GH Actions).
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

if (!cronSecret) fail("CRON_SECRET is missing.");

const path = "/api/cron/process-finance";

async function main() {
  const url = `${siteUrl}${path}`;
  console.log(`Finance cron — ${url}`);

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
    fail(`process-finance failed (${evaluated.reason}).`);
  }
  console.log("Finance cron completed.");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
