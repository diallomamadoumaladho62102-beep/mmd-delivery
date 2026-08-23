/**
 * Reconcile one Connect bank payout (po_*) against Stripe LIVE truth via CLI.
 * Corrects premature local "paid" → processing when Stripe is still pending.
 * NEVER creates a payout.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");

const DRIVER =
  process.env.RECONCILE_DRIVER_ID || "8c300089-6f16-407a-9be9-6eb75482f73d";
const ACCT = process.env.RECONCILE_ACCT || "acct_1TyRBBAmeKN9szbz";
const PO_ID =
  process.env.RECONCILE_PO_ID || "po_1U7WcyAmeKN9szbzvDcDRHH5";

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

function stripeJson(args) {
  return JSON.parse(
    execSync(`stripe ${args} --live`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}

function mapStripeStatus(stripeStatus) {
  const s = String(stripeStatus ?? "").toLowerCase();
  if (s === "paid") return "paid";
  if (s === "failed") return "failed";
  if (s === "canceled" || s === "cancelled") return "canceled";
  return "processing";
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";
if (!supabaseUrl || !supabaseKey) {
  console.error("FAIL: missing Supabase URL/service key");
  process.exit(1);
}

const sb = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

let payout;
try {
  payout = stripeJson(`payouts retrieve ${PO_ID} --stripe-account ${ACCT}`);
} catch (e) {
  console.error("FAIL: stripe live retrieve", String(e.stderr || e.message || e));
  process.exit(1);
}

const next = mapStripeStatus(String(payout.status));

const { data: rows, error } = await sb
  .from("payout_transactions")
  .select("id, status, amount_cents, external_reference, destination_account, paid_at")
  .eq("external_reference", PO_ID)
  .limit(5);

if (error) {
  console.error("FAIL: DB lookup", error.message);
  process.exit(1);
}

const report: {
  stripe_payout_id: string;
  stripe_account: string;
  stripe_status: unknown;
  stripe_method: unknown;
  stripe_amount: unknown;
  stripe_arrival_date: unknown;
  mmd_mapped_status: string;
  local_rows_before: unknown[];
  local_rows_by_amount?: unknown[];
  updates: Array<Record<string, unknown>>;
} = {
  stripe_payout_id: PO_ID,
  stripe_account: ACCT,
  stripe_status: payout.status,
  stripe_method: payout.method,
  stripe_amount: payout.amount,
  stripe_arrival_date: payout.arrival_date,
  mmd_mapped_status: next,
  local_rows_before: rows ?? [],
  updates: [],
};

for (const row of rows ?? []) {
  const local = String(row.status ?? "").toLowerCase();
  if (local === next) continue;
  const { error: upErr } = await sb
    .from("payout_transactions")
    .update({
      status: next,
      paid_at: next === "paid" ? new Date().toISOString() : null,
      provider_payload: {
        reconcile: true,
        source: "reconcile-bank-payout-po.mts",
        stripe_payout_id: PO_ID,
        stripe_status: payout.status,
        stripe_method: payout.method,
        driver_user_id: DRIVER,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("external_reference", PO_ID);
  report.updates.push({
    id: row.id,
    from: local,
    to: next,
    ok: !upErr,
    error: upErr?.message ?? null,
  });
}

// Also scan by amount+account if no row matched by po_ id
if ((rows ?? []).length === 0) {
  const { data: byAmt } = await sb
    .from("payout_transactions")
    .select("id, status, amount_cents, external_reference")
    .eq("recipient_user_id", DRIVER)
    .eq("amount_cents", Number(payout.amount ?? 0))
    .order("created_at", { ascending: false })
    .limit(5);
  report.local_rows_by_amount = byAmt ?? [];
  for (const row of byAmt ?? []) {
    const local = String(row.status ?? "").toLowerCase();
    const ext = String(row.external_reference ?? "");
    if (local === next && ext === PO_ID) continue;
    const { error: upErr } = await sb
      .from("payout_transactions")
      .update({
        status: next,
        external_reference: PO_ID,
        paid_at: next === "paid" ? new Date().toISOString() : null,
        provider_payload: {
          reconcile: true,
          source: "reconcile-bank-payout-po.mts",
          stripe_payout_id: PO_ID,
          stripe_status: payout.status,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    report.updates.push({
      id: row.id,
      from: local,
      to: next,
      linked_po: PO_ID,
      ok: !upErr,
      error: upErr?.message ?? null,
    });
  }
}

console.log(JSON.stringify(report, null, 2));
if (next !== "paid") {
  console.log(`PASS: Stripe=${payout.status} → MMD=${next} (no create⇒paid).`);
} else {
  console.log("PASS: Stripe paid — MMD may show paid.");
}
