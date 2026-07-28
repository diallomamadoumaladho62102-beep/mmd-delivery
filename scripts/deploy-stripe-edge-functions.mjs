#!/usr/bin/env node
/**
 * Deploy required Stripe Connect / payment Edge Functions to production.
 *
 * Usage (PowerShell):
 *   node scripts/deploy-stripe-edge-functions.mjs
 *   node scripts/deploy-stripe-edge-functions.mjs --dry-run
 *
 * Prerequisites:
 *   - supabase CLI logged in (`supabase login`)
 *   - linked project OR --project-ref
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "sjmszohmhudayxawfows";

/** Stripe payment / Connect functions required for production. */
export const STRIPE_EDGE_FUNCTIONS = [
  "create_connect_account",
  "check_connect_status",
  "sync_connect_status",
  "sync_restaurant_connect_status",
  "restaurant-connect-link",
  "create_payment_intent",
  "confirm_checkout_session",
  "pay-driver-now",
  "pay_restaurant_now",
  "pay_restaurant_scheduled",
  "weekly_restaurant_payout",
  "process_driver_payouts",
  "stripe_webhook",
];

const REQUIRED_SECRET_NAMES = [
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
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: r.status === 0,
    status: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
    projectRef:
      argv.find((a, i) => argv[i - 1] === "--project-ref") || PROJECT_REF,
  };
}

function main() {
  const { dryRun, projectRef } = parseArgs(process.argv);
  console.log(`[deploy-stripe-edge] project=${projectRef} dryRun=${dryRun}`);

  const secrets = run("npx", [
    "supabase",
    "secrets",
    "list",
    "--project-ref",
    projectRef,
  ]);
  if (!secrets.ok) {
    console.error("[deploy-stripe-edge] secrets list failed:", secrets.stderr);
    process.exit(1);
  }

  let names = [];
  try {
    const parsed = JSON.parse(secrets.stdout);
    names = (parsed.secrets || []).map((s) => s.name);
  } catch {
    // CLI may print table; fall back to line scan
    names = secrets.stdout
      .split(/\r?\n/)
      .map((l) => l.trim().split(/\s+/)[0])
      .filter(Boolean);
  }

  const missing = REQUIRED_SECRET_NAMES.filter((n) => !names.includes(n));
  if (missing.length) {
    console.error("[deploy-stripe-edge] MISSING secrets:", missing.join(", "));
    process.exit(1);
  }
  console.log("[deploy-stripe-edge] required secrets: OK");
  console.log(
    "[deploy-stripe-edge] note: MMD_EDGE_PAYOUTS_DISABLED + MMD_STRIPE_WEBHOOK_DISABLED expected true (Vercel canonical money/webhook)."
  );

  if (dryRun) {
    console.log("[deploy-stripe-edge] would deploy:");
    for (const fn of STRIPE_EDGE_FUNCTIONS) console.log(`  - ${fn}`);
    process.exit(0);
  }

  const failures = [];
  for (const fn of STRIPE_EDGE_FUNCTIONS) {
    console.log(`[deploy-stripe-edge] deploying ${fn}...`);
    const r = run("npx", [
      "supabase",
      "functions",
      "deploy",
      fn,
      "--project-ref",
      projectRef,
    ]);
    if (!r.ok) {
      console.error(r.stderr || r.stdout);
      failures.push(fn);
    } else {
      console.log(`[deploy-stripe-edge] OK ${fn}`);
    }
  }

  if (failures.length) {
    console.error("[deploy-stripe-edge] FAILED:", failures.join(", "));
    process.exit(1);
  }
  console.log("[deploy-stripe-edge] all Stripe Edge functions deployed.");
}

main();
