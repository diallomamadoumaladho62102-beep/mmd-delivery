/**
 * Instant Cash Out readiness probe (read-only by default).
 * Uses Stripe CLI --live for Connect balance/destination (local sk_test cannot).
 * NEVER creates a payout unless CONFIRM_INSTANT_CASHOUT=YES + --execute
 * (and even then this script refuses — founder must use the app once).
 *
 *   node scripts/instant-cashout-dry-run.mjs
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");
const DRIVER =
  process.env.INSTANT_PROBE_DRIVER_ID || "8c300089-6f16-407a-9be9-6eb75482f73d";
const ACCT = process.env.INSTANT_PROBE_ACCT || "acct_1TyRBBAmeKN9szbz";
const MIN = 1; // no dollar minimum — Instant-eligible amount > 0

function loadEnv() {
  for (const name of [".env.local", ".env"]) {
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

function sumUsd(rows) {
  return (rows || [])
    .filter((r) => String(r.currency).toLowerCase() === "usd")
    .reduce((s, r) => s + Math.max(0, Number(r.amount || 0)), 0);
}

function etDateKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

const balance = stripeJson(`balance retrieve --stripe-account ${ACCT}`);
const account = stripeJson(`get /v1/accounts/${ACCT}`);
const ext = stripeJson(
  `get /v1/accounts/${ACCT}/external_accounts -d limit=10`,
);

const available = sumUsd(balance.available);
const pending = sumUsd(balance.pending);
const instant = sumUsd(balance.instant_available);
const destinations = (ext.data || []).map((d) => ({
  id: d.id,
  object: d.object,
  last4: d.last4,
  bank_name: d.bank_name || null,
  available_payout_methods: d.available_payout_methods || [],
}));
const hasInstantDest = destinations.some((d) =>
  (d.available_payout_methods || []).includes("instant"),
);

const instantEligible = instant > 0 && hasInstantDest && account.payouts_enabled;
const cashable = instantEligible ? instant : available;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "",
  { auth: { persistSession: false } },
);
const etDate = etDateKey();
const { data: claim } = await sb
  .from("manual_cashout_daily_claims")
  .select("status, created_at, stripe_payout_id")
  .eq("recipient_type", "driver")
  .eq("recipient_user_id", DRIVER)
  .eq("et_date", etDate)
  .in("status", ["claimed", "processing", "paid"])
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

const blockers = [];
if (!account.payouts_enabled) blockers.push("payouts_enabled=false");
if (!hasInstantDest) blockers.push("no_instant_destination");
if (instant <= 0) blockers.push("instant_available_zero");
if (cashable < MIN) blockers.push(`nothing_to_cashout_${cashable}`);
if (claim) blockers.push(`already_cashed_out_today:${claim.status}`);

const report = {
  mode: "dry_run_read_only",
  connect: ACCT,
  driver: DRIVER,
  available_cents: available,
  pending_cents: pending,
  instant_available_cents: instant,
  cashable_cents: cashable,
  method_preferred: instantEligible ? "instant" : "standard",
  instant_eligible: instantEligible,
  payouts_enabled: account.payouts_enabled,
  destinations,
  et_date: etDate,
  today_claim: claim || null,
  meets_minimum_20: cashable >= MIN,
  ready_for_founder_app_test: blockers.length === 0,
  blockers,
  note:
    "No Stripe payout was created. Founder must confirm then Cash Out once in the app.",
};

console.log(JSON.stringify(report, null, 2));

console.log(`
=== TEST CONTRÔLÉ (1 seul Cash Out) — après votre confirmation ===
1) Stripe Dashboard plateforme: Settings → Payouts → Manual
2) Confirmer Instant Payouts Connect Express US activés
3) App Driver (user ${DRIVER}): Wallet → Cash Out UNE fois
   Montant serveur attendu ≈ $${(cashable / 100).toFixed(2)} (${instantEligible ? "Instant" : "Standard"})
4) Vérifier Stripe Connect ${ACCT}: nouveau payout + balances
5) Vérifier DB: payout_transactions paid + manual_cashout_daily_claims ${etDate}=paid
6) Interdit: 2e Cash Out le même jour America/New_York

Ce script n'exécute JAMAIS de payout réel.
`);

if (process.argv.includes("--execute") || process.env.CONFIRM_INSTANT_CASHOUT === "YES") {
  console.error(
    "REFUSING: real Instant Payout must be done via the authenticated app Cash Out after founder confirmation — not this script.",
  );
  process.exit(2);
}
