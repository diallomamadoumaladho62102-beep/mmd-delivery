#!/usr/bin/env node
/**
 * Post-deploy verification for Stripe Edge + Connect readiness (no EAS builds).
 *
 * Usage:
 *   node scripts/verify-stripe-payment-platform.mjs
 *
 * Optional env:
 *   SUPABASE_ANON_KEY / EXPO_PUBLIC_SUPABASE_ANON_KEY
 *   VERIFY_ACCESS_TOKEN  (user JWT for authenticated Connect probes)
 */
import { spawnSync } from "node:child_process";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "sjmszohmhudayxawfows";
const BASE = `https://${PROJECT_REF}.supabase.co/functions/v1`;
const WEBHOOK_CANONICAL = "https://www.mmddelivery.com/api/stripe/webhook";

const FUNCTIONS = [
  "create_connect_account",
  "check_connect_status",
  "sync_connect_status",
  "sync_restaurant_connect_status",
  "restaurant-connect-link",
  "create_payment_intent",
  "confirm_checkout_session",
  "pay-driver-now",
  "pay_restaurant_now",
  "stripe_webhook",
];

const REQUIRED_SECRETS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_RETURN_URL",
  "STRIPE_REFRESH_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

async function probe(name, anonKey, body = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(anonKey
      ? { Authorization: `Bearer ${anonKey}`, apikey: anonKey }
      : {}),
  };
  const token = process.env.VERIFY_ACCESS_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { name, status: res.status, body: json };
}

async function main() {
  const report = {
    project_ref: PROJECT_REF,
    secrets: { ok: false, missing: [] },
    edge_probes: [],
    vercel_webhook: null,
    apple_pay: {
      merchant_identifier: "merchant.com.maladho2025.mmddelivery",
      plugin: "@stripe/stripe-react-native",
      note: "Requires Apple Developer merchant ID + Stripe Dashboard Apple Pay domain verification + production iOS build (not Expo Go).",
    },
    google_pay: {
      merchant_country_code: "US",
      note: "PaymentSheet enables Google Pay on Android when wallet is available; Stripe Dashboard Google Pay must be enabled for the Live account.",
    },
    blockers: [],
  };

  const secrets = run("npx", [
    "supabase",
    "secrets",
    "list",
    "--project-ref",
    PROJECT_REF,
  ]);
  let names = [];
  try {
    names = (JSON.parse(secrets.stdout).secrets || []).map((s) => s.name);
  } catch {
    names = [];
  }
  report.secrets.missing = REQUIRED_SECRETS.filter((n) => !names.includes(n));
  report.secrets.ok = report.secrets.missing.length === 0;
  if (!report.secrets.ok) {
    report.blockers.push(`Missing Edge secrets: ${report.secrets.missing.join(", ")}`);
  }

  const anon =
    process.env.SUPABASE_ANON_KEY ||
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";

  for (const fn of FUNCTIONS) {
    const body =
      fn === "check_connect_status" || fn === "create_connect_account"
        ? { role: "driver" }
        : fn === "sync_connect_status"
          ? { role: "driver" }
          : {};
    const result = await probe(fn, anon, body);
    report.edge_probes.push(result);

    if (fn === "stripe_webhook") {
      const disabled = result.body?.disabled === true;
      const handler = result.body?.handler;
      if (!(result.status === 200 && disabled && handler === "vercel")) {
        report.blockers.push(
          "Edge stripe_webhook should be disabled with handler=vercel (canonical Vercel webhook)."
        );
      }
    }

    if (fn === "pay-driver-now" && result.body?.disabled === true) {
      report.blockers.push(
        "pay-driver-now is disabled via MMD_EDGE_PAYOUTS_DISABLED — Driver Cash Out Edge path is off (confirm intentional)."
      );
    }
  }

  try {
    const res = await fetch(WEBHOOK_CANONICAL, { method: "GET" });
    report.vercel_webhook = {
      url: WEBHOOK_CANONICAL,
      status: res.status,
      ok: res.status === 405 || res.status === 200 || res.status === 400,
    };
    if (!report.vercel_webhook.ok) {
      report.blockers.push(`Canonical Vercel webhook GET unexpected status ${res.status}`);
    }
  } catch (e) {
    report.vercel_webhook = {
      url: WEBHOOK_CANONICAL,
      error: e instanceof Error ? e.message : String(e),
    };
    report.blockers.push("Canonical Vercel webhook unreachable");
  }

  if (!process.env.VERIFY_ACCESS_TOKEN) {
    report.blockers.push(
      "VERIFY_ACCESS_TOKEN not set — authenticated Driver/Restaurant/Seller Connect probes skipped."
    );
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.secrets.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
