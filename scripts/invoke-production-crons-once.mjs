#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { evaluateCronHttpResult } from "./lib/evaluateCronHttpResult.mjs";

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1].trim()] = v;
  }
  return out;
}

const env = { ...loadEnv("apps/web/.env.local"), ...process.env };
const secret = String(env.CRON_SECRET || "").trim();
const site = String(
  env.SITE_URL || env.PRODUCTION_SITE_URL || "https://www.mmddelivery.com"
).replace(/\/$/, "");

async function call(path, { authMode = "good", query = "" } = {}) {
  const url = site + path + query;
  const headers = { "Content-Type": "application/json" };
  if (authMode === "good" && secret) {
    headers.Authorization = `Bearer ${secret}`;
  } else if (authMode === "wrong") {
    headers.Authorization = "Bearer wrong-secret-value";
  }
  const started = Date.now();
  let status = 0;
  let text = "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      signal: controller.signal,
    });
    status = res.status;
    text = await res.text();
  } catch (e) {
    console.log(
      JSON.stringify({
        path: path + query,
        authMode,
        network_error: e instanceof Error ? e.message : String(e),
        duration_ms: Date.now() - started,
      })
    );
    return;
  } finally {
    clearTimeout(timer);
  }
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { parse_error: true, raw_len: text.length };
  }
  const evaluated = evaluateCronHttpResult(status, text);
  console.log(
    JSON.stringify({
      path: path + query,
      authMode,
      status,
      evaluated_ok: evaluated.ok,
      evaluated_reason: evaluated.reason || null,
      duration_ms: Date.now() - started,
      ok: body?.ok ?? null,
      reason: body?.reason ?? null,
      dry_run: body?.dry_run ?? null,
      scanned: body?.scanned ?? null,
      eligible: body?.eligible ?? null,
      processed: body?.processed ?? body?.canceled_local ?? null,
      skipped: body?.skipped ?? null,
      failed: body?.failed ?? null,
      transfers_created: body?.transfers_created ?? null,
      no_eligible_drivers: body?.no_eligible_drivers ?? null,
      mode: body?.mode ?? null,
      lock_acquired: body?.lock_acquired ?? null,
      stripe_pi_canceled: body?.stripe_pi_canceled ?? null,
      stripe_pi_skipped: body?.stripe_pi_skipped ?? null,
      stripe_pi_already_canceled: body?.stripe_pi_already_canceled ?? null,
      canceled_local: body?.canceled_local ?? null,
      job: body?.job ?? null,
      run_id: body?.run_id ?? null,
      blockers_count: Array.isArray(body?.blockers) ? body.blockers.length : null,
    })
  );
}

console.log(
  JSON.stringify({
    site,
    secret_present: Boolean(secret),
    secret_length: secret.length,
  })
);

await call("/api/cron/expire-stale-payments", { authMode: "none" });
await call("/api/cron/expire-stale-payments", { authMode: "wrong" });
await call("/api/cron/expire-stale-payments", {
  authMode: "good",
  query: "?dry_run=1",
});
await call("/api/cron/expire-stale-payments", {
  authMode: "good",
  query: "?dry_run=0",
});
await call("/api/cron/taxi-payouts", { authMode: "good" });
await call("/api/cron/marketplace-payouts", { authMode: "good" });
await call("/api/orders/expire-unpaid", {
  authMode: "good",
  query: "?dry_run=1",
});
