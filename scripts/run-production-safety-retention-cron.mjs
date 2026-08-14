#!/usr/bin/env node
/**
 * Invoke production safety recording retention cron (GitHub Actions, every 6 h).
 * Retries transient network / 5xx upstream failures with linear backoff.
 * Endpoint is idempotent (purge expired only) — retries do not double-delete.
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
  Number(process.env.CRON_FETCH_TIMEOUT_MS ?? 120_000) || 120_000,
);
const maxAttempts = Math.max(
  1,
  Number(process.env.CRON_FETCH_MAX_ATTEMPTS ?? 3) || 3,
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

async function invokeOnce(attempt) {
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
      return {
        ok: false,
        retryable: true,
        failure: `${cronPath} timed out after ${fetchTimeoutMs}ms (attempt ${attempt}/${maxAttempts}).`,
      };
    }
    return {
      ok: false,
      retryable: true,
      failure: `${cronPath} network error: ${message} (attempt ${attempt}/${maxAttempts}).`,
    };
  } finally {
    clearTimeout(timer);
  }

  let bodyPreview = bodyText.trim();
  if (bodyPreview.length > 300) {
    bodyPreview = `${bodyPreview.slice(0, 300)}...`;
  }

  console.log(
    `${cronPath} -> HTTP ${response.status}${bodyPreview ? ` ${bodyPreview}` : ""}` +
      (attempt > 1 ? ` (attempt ${attempt}/${maxAttempts})` : ""),
  );

  const evaluated = evaluateCronHttpResult(response.status, bodyText);
  if (evaluated.ok) {
    return { ok: true };
  }

  const transientUpstream =
    response.status >= 500 &&
    /upstream connect error|connection failure|connect error: 111|ECONNREFUSED|reset before headers|ETIMEDOUT|socket hang up/i.test(
      bodyText,
    );

  const failure =
    response.status === 401
      ? `${cronPath} returned 401 Unauthorized. CRON_SECRET in GitHub Actions does not match Vercel production.`
      : response.status === 404
        ? `${cronPath} returned 404. Check SITE_URL (${siteUrl}) and Vercel deployment.`
        : `${cronPath} failed (${evaluated.reason}).`;

  return {
    ok: false,
    retryable: transientUpstream || response.status >= 500,
    failure,
  };
}

async function main() {
  let lastFailure = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await invokeOnce(attempt);
    if (result.ok) {
      console.log("Safety recording retention cron succeeded.");
      return;
    }

    lastFailure = result.failure;
    if (result.retryable && attempt < maxAttempts) {
      const waitMs = 1500 * attempt;
      console.warn(`${lastFailure} Retrying in ${waitMs}ms…`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    fail(lastFailure);
  }

  fail(lastFailure || `${cronPath} failed after ${maxAttempts} attempts.`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
