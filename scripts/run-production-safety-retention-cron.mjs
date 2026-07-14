#!/usr/bin/env node
/**
 * Invoke production safety recording retention cron (GitHub Actions, every 6 h).
 */
import { evaluateCronHttpResult } from "./lib/evaluateCronHttpResult.mjs";

const siteUrl = String(
  process.env.SITE_URL || process.env.PRODUCTION_SITE_URL || "https://www.mmddelivery.com",
)
  .trim()
  .replace(/\/$/, "");
const cronSecret = String(process.env.CRON_SECRET ?? "").trim();
const cronPath = "/api/cron/ride-safety-recording-retention";
const fetchTimeoutMs = Math.max(
  5_000,
  Number(process.env.CRON_FETCH_TIMEOUT_MS ?? 120_000) || 120_000
);

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
    const message = error instanceof Error ? error.message : String(error);
    if (controller.signal.aborted || /aborted|timeout/i.test(message)) {
      fail(`${cronPath} timed out after ${fetchTimeoutMs}ms.`);
    }
    fail(`${cronPath} network error: ${message}`);
  } finally {
    clearTimeout(timer);
  }

  let bodyPreview = bodyText.trim();
  if (bodyPreview.length > 300) {
    bodyPreview = `${bodyPreview.slice(0, 300)}...`;
  }

  console.log(`${cronPath} -> HTTP ${response.status}${bodyPreview ? ` ${bodyPreview}` : ""}`);

  const evaluated = evaluateCronHttpResult(response.status, bodyText);
  if (!evaluated.ok) {
    if (response.status === 401) {
      fail(
        `${cronPath} returned 401 Unauthorized. CRON_SECRET in GitHub Actions does not match Vercel production.`,
      );
    }
    if (response.status === 404) {
      fail(`${cronPath} returned 404. Check SITE_URL (${siteUrl}) and Vercel deployment.`);
    }
    fail(`${cronPath} failed (${evaluated.reason}).`);
  }

  console.log("Safety recording retention cron succeeded.");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
