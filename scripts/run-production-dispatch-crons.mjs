#!/usr/bin/env node
/**
 * Invoke production dispatch cron routes (used by GitHub Actions workflow).
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
  Number(process.env.CRON_FETCH_TIMEOUT_MS ?? 60_000) || 60_000
);

const cronPaths = [
  "/api/cron/retry-order-dispatch",
  "/api/cron/retry-taxi-dispatch",
  "/api/cron/retry-delivery-request-dispatch",
  "/api/cron/taxi-scheduled-dispatch",
  "/api/cron/taxi-active-ride-compliance",
  // Hobby Vercel forbids sub-daily crons; finance posting runs here instead.
  "/api/cron/process-finance",
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
      fail(`${path} timed out after ${fetchTimeoutMs}ms.`);
    }
    fail(`${path} network error: ${message}`);
  } finally {
    clearTimeout(timer);
  }

  let bodyPreview = bodyText.trim();
  if (bodyPreview.length > 300) {
    bodyPreview = `${bodyPreview.slice(0, 300)}...`;
  }

  console.log(`${path} -> HTTP ${response.status}${bodyPreview ? ` ${bodyPreview}` : ""}`);

  const evaluated = evaluateCronHttpResult(response.status, bodyText);
  if (!evaluated.ok) {
    if (response.status === 401) {
      fail(
        `${path} returned 401 Unauthorized. CRON_SECRET in GitHub Actions does not match Vercel production.`,
      );
    }
    if (response.status === 404) {
      fail(`${path} returned 404. Check SITE_URL (${siteUrl}) and Vercel deployment.`);
    }
    fail(`${path} failed (${evaluated.reason}).`);
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
