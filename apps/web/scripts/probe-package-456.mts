/**
 * Read-only Package $4.56 / balance_insufficient probe.
 * NEVER invents Connect credit. NEVER creates transfers.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");
const DRIVER =
  process.env.PACKAGE_PROBE_DRIVER_ID || "8c300089-6f16-407a-9be9-6eb75482f73d";
const TARGET_CENTS = Number(process.env.PACKAGE_PROBE_CENTS || 456);

function loadEnv() {
  for (const name of [".env.local", ".env", ".env.production.local"]) {
    const p = path.join(webRoot, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

const stripeKey = process.env.STRIPE_SECRET_KEY || "";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";

if (!stripeKey || !supabaseUrl || !supabaseKey) {
  console.error("FAIL: missing Stripe/Supabase env");
  process.exit(1);
}

const stripe = new Stripe(stripeKey, {
  apiVersion: "2023-10-16" as Stripe.LatestApiVersion,
});
const sb = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

const { data: orders } = await sb
  .from("orders")
  .select(
    "id, status, payment_status, driver_id, driver_delivery_payout, driver_transfer_id, stripe_payment_intent_id, external_ref_type, external_ref_id, created_at",
  )
  .eq("driver_id", DRIVER)
  .eq("external_ref_type", "delivery_request")
  .order("created_at", { ascending: false })
  .limit(30);

const matches = (orders ?? []).filter((o) => {
  const payout = Math.round(Number(o.driver_delivery_payout ?? 0) * 100);
  return payout === TARGET_CENTS || Math.abs(payout - TARGET_CENTS) <= 1;
});

const platform = await stripe.balance.retrieve();
const availableUsd = (platform.available ?? [])
  .filter((b) => String(b.currency).toLowerCase() === "usd")
  .reduce((s, b) => s + Number(b.amount ?? 0), 0);

let platformSchedule: unknown = null;
try {
  const acct = await stripe.accounts.retrieve();
  platformSchedule =
    (acct as { settings?: { payouts?: { schedule?: unknown } } }).settings
      ?.payouts?.schedule ?? null;
} catch (e) {
  platformSchedule = {
    error: e instanceof Error ? e.message : String(e),
  };
}

const report = {
  target_cents: TARGET_CENTS,
  driver_id: DRIVER,
  matching_orders: matches,
  platform_available_usd_cents: availableUsd,
  platform_can_fund_target: availableUsd >= TARGET_CENTS,
  platform_payout_schedule: platformSchedule,
  verdict:
    availableUsd >= TARGET_CENTS
      ? "READY_FOR_SCT_RETRY — no artificial credit; run process-payouts / ensureWorkerConnectCredit"
      : "OPEN — Stripe Ops: platform available insufficient for Package SCT (no fake credit)",
};

console.log(JSON.stringify(report, null, 2));
