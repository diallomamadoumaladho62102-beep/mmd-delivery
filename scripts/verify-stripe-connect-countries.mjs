#!/usr/bin/env node
/**
 * Verify Stripe Connect Express account countries for driver/restaurant profiles.
 *
 * Usage:
 *   node scripts/verify-stripe-connect-countries.mjs
 *   node scripts/verify-stripe-connect-countries.mjs --report-only
 *   node scripts/verify-stripe-connect-countries.mjs --suggest-reset
 *
 * Requires:
 *   STRIPE_SECRET_KEY
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const args = new Set(process.argv.slice(2));
const reportOnly = args.has("--report-only");
const suggestReset = args.has("--suggest-reset");

function requiredEnv(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing env: ${name}`);
  }
  return value;
}

function inferExpectedCountry(profile) {
  const city = String(profile.city ?? "").trim().toUpperCase();
  if (city.includes("CONAKRY") || city.includes("GUINE")) return "GN";
  if (city.includes("DAKAR") || city.includes("SENEGAL")) return "SN";
  if (city.includes("ABIDJAN") || city.includes("IVOIRE")) return "CI";
  if (city.includes("BAMAKO") || city.includes("MALI")) return "ML";
  if (city.includes("FREETOWN") || city.includes("SIERRA")) return "SL";
  if (city.includes("NOUAKCHOTT") || city.includes("MAURITAN")) return "MR";
  const state = String(profile.state ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(state)) return state;
  return "US";
}

async function loadProfiles(supabase, table) {
  const { data, error } = await supabase
    .from(table)
    .select("user_id, stripe_account_id, city, state")
    .not("stripe_account_id", "is", null);

  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []).map((row) => ({ ...row, role: table === "driver_profiles" ? "driver" : "restaurant" }));
}

async function main() {
  const stripe = new Stripe(requiredEnv("STRIPE_SECRET_KEY"), {
    apiVersion: "2023-10-16",
  });

  const supabase = createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );

  const profiles = [
    ...(await loadProfiles(supabase, "driver_profiles")),
    ...(await loadProfiles(supabase, "restaurant_profiles")),
  ];

  const mismatches = [];
  const missingCountry = [];
  const ok = [];

  for (const profile of profiles) {
    const accountId = String(profile.stripe_account_id ?? "").trim();
    if (!accountId) continue;

    const expected = inferExpectedCountry(profile);
    let account;

    try {
      account = await stripe.accounts.retrieve(accountId);
    } catch (error) {
      mismatches.push({
        role: profile.role,
        user_id: profile.user_id,
        account_id: accountId,
        expected_country: expected,
        issue: "retrieve_failed",
        detail: error instanceof Error ? error.message : "unknown",
      });
      continue;
    }

    const actual = String(account.country ?? "").trim().toUpperCase() || null;

    if (!actual) {
      missingCountry.push({
        role: profile.role,
        user_id: profile.user_id,
        account_id: accountId,
        expected_country: expected,
      });
      continue;
    }

    if (actual !== expected) {
      mismatches.push({
        role: profile.role,
        user_id: profile.user_id,
        account_id: accountId,
        expected_country: expected,
        actual_country: actual,
        issue: "country_mismatch",
      });
      continue;
    }

    ok.push({
      role: profile.role,
      user_id: profile.user_id,
      account_id: accountId,
      country: actual,
    });
  }

  const summary = {
    scanned: profiles.length,
    ok: ok.length,
    missing_country: missingCountry.length,
    mismatches: mismatches.length,
  };

  console.log(JSON.stringify({ summary, ok, missingCountry, mismatches }, null, 2));

  if (suggestReset && !reportOnly) {
    const resetCandidates = [...missingCountry, ...mismatches.filter((m) => m.issue === "country_mismatch")];
    if (resetCandidates.length === 0) {
      console.log("\nNo reset candidates.");
      return;
    }

    console.log("\nSuggested manual remediation (Stripe country is immutable on Express accounts):");
    for (const row of resetCandidates) {
      const table = row.role === "driver" ? "driver_profiles" : "restaurant_profiles";
      console.log(
        `-- ${table} user ${row.user_id}: clear stripe_account_id and re-run onboarding with country ${row.expected_country}`
      );
      console.log(
        `update public.${table} set stripe_account_id = null, stripe_onboarded = false where user_id = '${row.user_id}';`
      );
    }
  }

  if (summary.missing_country + summary.mismatches > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
