#!/usr/bin/env node
/**
 * Production ops: cancel abandoned Fouta + MMD Delivery via official resolve-stale-job,
 * then run taxi-payouts for pending Driver SCTs ($13.29).
 *
 * Requires CRON_SECRET matching Vercel production.
 * Does NOT invent transfers — uses /api/cron/taxi-payouts + executeTaxiDriverFareTransfer.
 */
import { createRequire } from "node:module";
import { evaluateCronHttpResult } from "./lib/evaluateCronHttpResult.mjs";

const require = createRequire(import.meta.url);
require("dotenv").config({ path: "apps/web/.env.local" });
require("dotenv").config({
  path: "docs/production/final-certification.env",
  override: false,
});
require("dotenv").config({
  path: "apps/web/.env.vercel.production.local",
  override: false,
});

const siteUrl = String(
  process.env.SITE_URL ||
    process.env.PRODUCTION_SITE_URL ||
    "https://www.mmddelivery.com",
)
  .trim()
  .replace(/\/$/, "");
const cronSecret = String(process.env.CRON_SECRET ?? "").trim();

if (!cronSecret) {
  console.error("CRON_SECRET missing");
  process.exit(1);
}

async function postJson(path, body) {
  const res = await fetch(`${siteUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cronSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, json };
}

const FOUTA = "85461a64-5fd4-4eaf-9819-1c60edea8c3f";
const MMD = "5c5cb494-bcd7-40d9-8de6-15913694a713";
const RIDE_450 = "60b77443-a1b1-4ae3-a416-66b6a4772832";
const RIDE_879 = "f7c2b487-7ad6-4eb6-8b46-26458438a8fd";

console.log("1) Cancel abandoned Fouta order…");
const fouta = await postJson("/api/admin/ops/resolve-stale-job", {
  id: FOUTA,
  source_table: "orders",
  action: "cancel",
  reason: "admin_stale_job_abandoned_cancel_cert_leftover",
});
console.log(JSON.stringify({ http: fouta.status, body: fouta.json }, null, 2));

console.log("2) Cancel abandoned MMD Delivery…");
const mmd = await postJson("/api/admin/ops/resolve-stale-job", {
  id: MMD,
  source_table: "delivery_requests",
  action: "cancel",
  reason: "admin_stale_job_abandoned_cancel_cert_leftover",
});
console.log(JSON.stringify({ http: mmd.status, body: mmd.json }, null, 2));

console.log("3) taxi-payouts inventory…");
const inv = await postJson("/api/cron/taxi-payouts?inventory_only=1&limit=0", {});
console.log(JSON.stringify({ http: inv.status, body: inv.json }, null, 2));

console.log("4) taxi-payouts live (limit=10)…");
const pay = await postJson("/api/cron/taxi-payouts?limit=10", {});
console.log(JSON.stringify({ http: pay.status, body: pay.json }, null, 2));
const evaluated = evaluateCronHttpResult(pay.status, JSON.stringify(pay.json));
if (!evaluated.ok) {
  console.error("taxi-payouts failed:", evaluated.reason);
  process.exit(1);
}

console.log("5) taxi-run idempotency retry for both rides…");
for (const rideId of [RIDE_450, RIDE_879]) {
  const r1 = await postJson("/api/stripe/transfers/taxi-run", {
    taxi_ride_id: rideId,
    dry_run: false,
  });
  const r2 = await postJson("/api/stripe/transfers/taxi-run", {
    taxi_ride_id: rideId,
    dry_run: false,
  });
  console.log(
    JSON.stringify(
      {
        rideId,
        first: { http: r1.status, transfer: r1.json?.transfer_id, already: r1.json?.already_succeeded },
        second: {
          http: r2.status,
          transfer: r2.json?.transfer_id,
          already: r2.json?.already_succeeded,
        },
      },
      null,
      2,
    ),
  );
}

console.log("DONE");
