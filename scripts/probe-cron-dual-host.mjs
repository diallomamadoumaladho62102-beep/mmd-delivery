#!/usr/bin/env node
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
const secret = String(env.CRON_SECRET || "").trim();
const bases = [
  "https://mmd-delivery-h1vstsngm-diallomamadoumaladho62102-beeps-projects.vercel.app",
  "https://www.mmddelivery.com",
];
const path = process.argv[2] || "/api/cron/marketplace-payouts";

for (const base of bases) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  const started = Date.now();
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        "x-vercel-protection-bypass":
          String(env.VERCEL_AUTOMATION_BYPASS_SECRET || "").trim() || undefined,
      },
      signal: controller.signal,
    });
    const text = await res.text();
    let body = {};
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 180) };
    }
    console.log(
      JSON.stringify({
        base,
        path,
        status: res.status,
        duration_ms: Date.now() - started,
        ok: body.ok ?? null,
        reason: body.reason ?? null,
        mode: body.mode ?? null,
        scanned: body.scanned ?? null,
        transfers_created: body.transfers_created ?? null,
        no_eligible_drivers: body.no_eligible_drivers ?? null,
        lock_acquired: body.lock_acquired ?? null,
        run_id: body.run_id ?? null,
        error: body.error ?? null,
      })
    );
  } catch (e) {
    console.log(
      JSON.stringify({
        base,
        path,
        error: e instanceof Error ? e.message : String(e),
        duration_ms: Date.now() - started,
      })
    );
  } finally {
    clearTimeout(timer);
  }
}
