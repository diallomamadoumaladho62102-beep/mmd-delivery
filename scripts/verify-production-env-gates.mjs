#!/usr/bin/env node
/**
 * Fail closed on production env misconfiguration for CRITICAL/HIGH launch gates.
 * Usage: node scripts/verify-production-env-gates.mjs
 * Reads process.env (export Vercel env locally or run in CI with secrets).
 */
const isProd =
  process.env.VERCEL_ENV === "production" ||
  process.env.FORCE_PRODUCTION_ENV_CHECK === "true";

let failed = 0;

function req(name) {
  const v = String(process.env[name] ?? "").trim();
  if (!v) {
    console.log(`FAIL missing ${name}`);
    failed += 1;
    return false;
  }
  console.log(`PASS ${name} set`);
  return true;
}

function mustBe(name, expected) {
  const v = String(process.env[name] ?? "").trim();
  if (v !== expected) {
    console.log(`FAIL ${name} must be "${expected}" (got "${v || "<empty>"}")`);
    failed += 1;
    return false;
  }
  console.log(`PASS ${name}=${expected}`);
  return true;
}

console.log(`Production env gate check (isProd=${isProd})\n`);

if (!isProd) {
  console.log("SKIP — set VERCEL_ENV=production or FORCE_PRODUCTION_ENV_CHECK=true to enforce.");
  process.exit(0);
}

req("CRON_SECRET");
req("MAPBOX_ACCESS_TOKEN");
req("NEXT_PUBLIC_MAPBOX_TOKEN");
req("NEXT_PUBLIC_SENTRY_DSN");
req("STRIPE_SECRET_KEY");
req("STRIPE_WEBHOOK_SECRET");

mustBe("MARKETPLACE_CHECKOUT_LIVE_ENABLED", "false");
mustBe("MARKETPLACE_DISPATCH_LIVE_ENABLED", "false");
mustBe("MARKETPLACE_PAYOUTS_LIVE_ENABLED", "false");
mustBe("MARKETPLACE_SELLER_PAYOUTS_E2E_READY", "false");

// When scope gates are enabled for US launch, county gates must also be on.
const scope = String(process.env.PLATFORM_SCOPE_GATES_ENABLED ?? "").trim().toLowerCase();
const county = String(process.env.PLATFORM_US_COUNTY_GATES ?? "").trim().toLowerCase();
if (scope === "true" && county !== "true") {
  console.log(
    "FAIL PLATFORM_SCOPE_GATES_ENABLED=true requires PLATFORM_US_COUNTY_GATES=true for US county control"
  );
  failed += 1;
} else if (scope === "true") {
  console.log("PASS county gates aligned with scope gates");
} else {
  console.log(
    "WARN PLATFORM_SCOPE_GATES_ENABLED is not true — county commercial controls remain inactive until enabled"
  );
}

console.log(`\n${failed === 0 ? "ALL CHECKS PASSED" : `${failed} CHECK(S) FAILED`}`);
process.exit(failed > 0 ? 1 : 0);
