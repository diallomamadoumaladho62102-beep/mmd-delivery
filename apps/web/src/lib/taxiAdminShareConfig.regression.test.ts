/**
 * Taxi share % must come from Admin/DB (taxi_pricing), never hard-coded in TS/SQL runtime.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitTaxiNetCommissionCents } from "./taxi/taxiQuoteCheckoutDiscounts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

function quoteShares(subtotal: number, driverPct: number, platformPct: number) {
  const driver = Math.round((subtotal * driverPct) / 100);
  const platform = Math.round((subtotal * platformPct) / 100);
  return { driver, platform };
}

test("quote_taxi_ride reads driver_share_pct from taxi_pricing table", () => {
  const sql = fs.readFileSync(
    path.join(repoRoot, "supabase/migrations/20260619120000_taxi_global_final_p0_closure.sql"),
    "utf8",
  );
  assert.match(sql, /v_pricing\.driver_share_pct/);
  assert.match(sql, /v_pricing\.platform_share_pct/);
  assert.match(sql, /from public\.taxi_pricing tp/);
});

test("recalculate_taxi_ride_totals has no hardcoded 75% fallback", () => {
  const mig = fs.readFileSync(
    path.join(
      repoRoot,
      "supabase/migrations/20261125120000_taxi_recalculate_no_hardcoded_share.sql",
    ),
    "utf8",
  );
  assert.doesNotMatch(mig, /v_driver_share numeric := 75/);
  assert.match(mig, /driver_share_unresolved/);
  assert.match(mig, /from public\.taxi_pricing tp/);
});

test("split engine uses quote RPC shares — config A 70/30 vs config B 75/25 differ", () => {
  const subtotal = 10000;
  const tax = 800;
  const service = 500;
  const customer = subtotal + tax + service;

  const cfgA = quoteShares(subtotal, 70, 30);
  const splitA = splitTaxiNetCommissionCents({
    customerNetTotalCents: customer,
    quoteDriverPayoutCents: cfgA.driver,
    quotePlatformFeeCents: cfgA.platform,
    subtotalCents: subtotal,
    serviceFeeCents: service,
    taxCents: tax,
    discountCents: 0,
  });

  const cfgB = quoteShares(subtotal, 75, 25);
  const splitB = splitTaxiNetCommissionCents({
    customerNetTotalCents: customer,
    quoteDriverPayoutCents: cfgB.driver,
    quotePlatformFeeCents: cfgB.platform,
    subtotalCents: subtotal,
    serviceFeeCents: service,
    taxCents: tax,
    discountCents: 0,
  });

  assert.equal(splitA.driver_payout_cents, 7000);
  assert.equal(splitB.driver_payout_cents, 7500);
  assert.notEqual(splitA.driver_payout_cents, splitB.driver_payout_cents);
  assert.equal(splitA.driver_payout_cents + splitA.platform_fee_cents + tax, customer);
  assert.equal(splitB.driver_payout_cents + splitB.platform_fee_cents + tax, customer);
});

test("checkout split module has no embedded driver share percentage literals", () => {
  const src = fs.readFileSync(
    path.join(repoRoot, "apps/web/src/lib/taxi/taxiQuoteCheckoutDiscounts.ts"),
    "utf8",
  );
  assert.doesNotMatch(src, /driver_share_pct\s*=\s*\d/);
  assert.doesNotMatch(src, /\*\s*0\.75/);
  assert.doesNotMatch(src, /\*\s*0\.70/);
  assert.match(src, /quoteDriverPayoutCents/);
});

test("admin taxi-pricing PATCH validates share sum from saved config", () => {
  const src = fs.readFileSync(
    path.join(repoRoot, "apps/web/app/api/admin/taxi-pricing/route.ts"),
    "utf8",
  );
  assert.match(src, /driver_share_pct/);
  assert.match(src, /platform_share_pct/);
  assert.match(src, /sum ≤ 100/);
});

console.log("taxiAdminShareConfig.regression passed");
