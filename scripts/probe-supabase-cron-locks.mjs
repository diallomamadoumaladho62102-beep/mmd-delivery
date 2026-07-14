#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";

function load(p) {
  const o = {};
  if (!existsSync(p)) return o;
  for (const line of readFileSync(p, "utf8").split(/\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    o[m[1].trim()] = v;
  }
  return o;
}

const e = load("apps/web/.env.vercel.production.local");
const url = e.NEXT_PUBLIC_SUPABASE_URL;
const key = e.SUPABASE_SERVICE_ROLE_KEY;
console.log(
  JSON.stringify({
    url_present: Boolean(url),
    key_present: Boolean(key),
    key_len: (key || "").length,
  })
);

const controller = new AbortController();
const t = setTimeout(() => controller.abort(), 15_000);
const started = Date.now();
try {
  const res = await fetch(
    `${url}/rest/v1/cron_job_locks?select=job_name,locked_by,locked_until&limit=20`,
    {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: controller.signal,
    }
  );
  const text = await res.text();
  console.log(
    JSON.stringify({
      status: res.status,
      duration_ms: Date.now() - started,
      body: text.slice(0, 800),
    })
  );

  const rpc = await fetch(`${url}/rest/v1/rpc/try_acquire_cron_job_lock`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_job_name: "ops-healthcheck",
      p_locked_by: "ops-probe",
      p_ttl_seconds: 30,
    }),
  });
  const rpcText = await rpc.text();
  console.log(
    JSON.stringify({
      rpc_status: rpc.status,
      rpc_body: rpcText.slice(0, 400),
    })
  );
  await fetch(`${url}/rest/v1/rpc/release_cron_job_lock`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_job_name: "ops-healthcheck",
      p_locked_by: "ops-probe",
      p_error: null,
    }),
  });
} catch (err) {
  console.log(
    JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - started,
    })
  );
} finally {
  clearTimeout(t);
}
