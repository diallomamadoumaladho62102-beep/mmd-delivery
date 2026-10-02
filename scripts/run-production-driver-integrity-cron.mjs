#!/usr/bin/env node
/**
 * Dedicated Driver Integrity scan. Cadence is infrastructure-only.
 * Business thresholds remain Admin-configurable. Flags OFF => no-op scan.
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
  Number(process.env.CRON_FETCH_TIMEOUT_MS ?? 90_000) || 90_000
);

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!cronSecret) {
  fail("CRON_SECRET is missing. Add repository secret CRON_SECRET in GitHub Actions.");
}

async function main() {
  const path = "/api/cron/driver-integrity";
  const url = `${siteUrl}${path}`;
  const maxAttempts = Math.max(1, Number(process.env.CRON_FETCH_MAX_ATTEMPTS ?? 3) || 3);
  let lastFailure = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cronSecret}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });
      const bodyText = await response.text();
      console.log(`${path} -> HTTP ${response.status} ${bodyText.slice(0, 300)}`);
      const evaluated = evaluateCronHttpResult(response.status, bodyText);
      if (evaluated.ok) return;
      lastFailure = `${path} failed (${evaluated.reason}).`;
      if (response.status >= 500 && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      fail(lastFailure);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastFailure = `${path} ${message}`;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      fail(lastFailure);
    } finally {
      clearTimeout(timer);
    }
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
