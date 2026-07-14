#!/usr/bin/env node
/**
 * Progressive production cron probes after instrumentation deploy.
 * Reads CRON_SECRET from apps/web/.env.vercel.production.local (no secret print).
 */
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

const env = loadEnv("apps/web/.env.vercel.production.local");
const secret = String(env.CRON_SECRET || "").trim();
const site = String(env.NEXT_PUBLIC_SITE_URL || "https://www.mmddelivery.com").replace(
  /\/$/,
  ""
);

if (!secret) {
  console.error(JSON.stringify({ ok: false, error: "cron_secret_missing_locally" }));
  process.exit(1);
}

async function probe(path, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${site}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    const text = await res.text();
    const evaluated = evaluateCronHttpResult(res.status, text);
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { parse_error: true, raw_len: text.length };
    }
    const phases = Array.isArray(body.phases)
      ? body.phases.map((p) => ({
          phase: p.phase,
          elapsed_ms: p.elapsed_ms,
          phase_ms: p.phase_ms,
        }))
      : [];
    console.log(
      JSON.stringify({
        path,
        status: res.status,
        evaluated_ok: evaluated.ok,
        evaluated_reason: evaluated.reason || null,
        duration_ms: Date.now() - started,
        ok: body.ok ?? null,
        reason: body.reason ?? null,
        error: body.error ?? null,
        dry_run: body.dry_run ?? null,
        scanned: body.scanned ?? null,
        eligible: body.eligible ?? null,
        transfers_created: body.transfers_created ?? null,
        no_eligible_drivers: body.no_eligible_drivers ?? null,
        mode: body.mode ?? null,
        lock_acquired: body.lock_acquired ?? null,
        partial: body.partial ?? null,
        run_id: body.run_id ?? null,
        job: body.job ?? null,
        last_phase: phases.length ? phases[phases.length - 1] : null,
        phases,
      })
    );
    return { ok: evaluated.ok, body };
  } catch (e) {
    console.log(
      JSON.stringify({
        path,
        error: e instanceof Error ? e.message : String(e),
        duration_ms: Date.now() - started,
      })
    );
    return { ok: false, body: null };
  } finally {
    clearTimeout(timer);
  }
}

console.log(JSON.stringify({ site, secret_present: true }));

await probe("/api/cron/infra-probe");
await probe("/api/cron/infra-probe?stripe=1");
await probe("/api/cron/taxi-payouts?limit=0&inventory_only=1");
await probe("/api/cron/marketplace-payouts?limit=0");
await probe("/api/cron/expire-stale-payments?dry_run=1&limit=0");
await probe("/api/cron/expire-stale-payments?dry_run=1&limit=1");
await probe("/api/cron/taxi-payouts?limit=1");
await probe("/api/cron/marketplace-payouts?limit=1");
await probe("/api/cron/taxi-monitoring-snapshot");
