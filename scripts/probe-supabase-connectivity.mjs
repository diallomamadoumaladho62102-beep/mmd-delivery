#!/usr/bin/env node
/**
 * Read-only connectivity probe to Supabase REST from this host.
 * Does not print secrets.
 */
import { readFileSync, existsSync } from "node:fs";

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
const url = String(env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

console.log(
  JSON.stringify({
    url_host: url ? new URL(url).host : null,
    key_present: Boolean(key),
    key_len: key.length,
  })
);

if (!url || !key) {
  process.exit(1);
}

async function hit(path, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${url}${path}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      signal: controller.signal,
    });
    const text = await res.text();
    console.log(
      JSON.stringify({
        path,
        status: res.status,
        ms: Date.now() - started,
        body_head: text.slice(0, 160),
      })
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        path,
        error: error instanceof Error ? error.message : String(error),
        ms: Date.now() - started,
      })
    );
  } finally {
    clearTimeout(timer);
  }
}

async function hitAuth(path, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${url}${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    console.log(
      JSON.stringify({
        path,
        status: res.status,
        ms: Date.now() - started,
      })
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        path,
        error: error instanceof Error ? error.message : String(error),
        ms: Date.now() - started,
      })
    );
  } finally {
    clearTimeout(timer);
  }
}

await hitAuth("/auth/v1/health", 5_000);
await hit("/rest/v1/", 5_000);
await hit(
  "/rest/v1/cron_job_locks?select=job_name,locked_by,locked_until&limit=10",
  12_000
);
await hit("/rest/v1/rpc/refresh_taxi_monitoring_snapshot", 8_000);
