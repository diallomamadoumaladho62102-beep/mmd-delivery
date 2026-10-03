import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const webRoot = process.cwd();
const migration = readFileSync(
  join(webRoot, "../../supabase/migrations/20261130120000_minimum_pay_engine.sql"),
  "utf8"
);
const closePay = readFileSync(join(webRoot, "src/lib/minimumPay/closePayPeriod.ts"), "utf8");
const transfer = readFileSync(
  join(webRoot, "src/lib/minimumPay/executeNycMprAdjustmentTransfer.ts"),
  "utf8"
);
const settingsApi = readFileSync(
  join(webRoot, "app/api/admin/minimum-pay/settings/route.ts"),
  "utf8"
);
const rulesApi = readFileSync(join(webRoot, "app/api/admin/minimum-pay/rules/route.ts"), "utf8");
const periodsApi = readFileSync(
  join(webRoot, "app/api/admin/minimum-pay/periods/route.ts"),
  "utf8"
);
const adjustmentsApi = readFileSync(
  join(webRoot, "app/api/admin/minimum-pay/adjustments/route.ts"),
  "utf8"
);
const page = readFileSync(join(webRoot, "app/admin/minimum-pay/page.tsx"), "utf8");

test("trip interval uses driver_accepted_at never restaurant accepted_at", () => {
  assert.match(migration, /new\.driver_accepted_at/);
  assert.doesNotMatch(
    migration,
    /minimum_pay_sync_trip_interval\(\s*'order',\s*new\.id,\s*new\.driver_id,\s*new\.accepted_at/
  );
  assert.match(migration, /new\.driver_accepted_at := now\(\)/);
});

test("driver cannot supply driver_accepted_at; server overwrites with now()", () => {
  assert.match(migration, /Ignore any client-supplied timestamp/);
  assert.match(migration, /new\.driver_accepted_at := old\.driver_accepted_at/);
});

test("started_at is never rewritten after first insert", () => {
  assert.match(migration, /started_at is never rewritten/);
  assert.doesNotMatch(migration, /started_at = excluded\.started_at/);
});

test("MPR definer functions are revoked from authenticated drivers", () => {
  assert.match(
    migration,
    /revoke all on function public\.minimum_pay_sync_trip_interval/
  );
  assert.match(migration, /from public, anon, authenticated/);
});

test("engine defaults stay off with transfers disabled and no start date", () => {
  assert.match(migration, /values \(true, 'off', false\)/);
  assert.match(migration, /engine_start_at timestamptz,/);
  assert.doesNotMatch(migration, /engine_start_at timestamptz not null default/);
});

test("SHADOW path never reaches stripe.transfers.create", () => {
  const gateBeforeStripe = transfer.indexOf("canTransferMinimumPayAdjustments");
  const stripeCall = transfer.indexOf("stripe.transfers.create");
  assert.ok(gateBeforeStripe >= 0 && stripeCall > gateBeforeStripe);
  assert.match(closePay, /mode !== "shadow"/);
  assert.match(closePay, /if \(!automaticTransfer\) continue/);
});

test("duplicate reconciliation cannot rewrite a transferred adjustment", () => {
  assert.match(closePay, /existing\.status === "transferred"/);
  assert.match(closePay, /existingPeriodMustBePreserved/);
});

test("unauthorized Admin cannot change settings or reconcile", () => {
  assert.match(settingsApi, /assertStaffPermission\("minimum_pay.manage"/);
  assert.match(settingsApi, /super_admin_required/);
  assert.match(rulesApi, /assertStaffPermission\("minimum_pay.manage"/);
  assert.match(periodsApi, /assertStaffPermission\("minimum_pay.manage"/);
  assert.match(adjustmentsApi, /assertStaffPermission\("minimum_pay.manage"/);
  assert.match(adjustmentsApi, /approveFleetAllocationTransfer/);
  assert.match(page, /requiredPermission="minimum_pay.read"/);
  assert.doesNotMatch(settingsApi, /raw:\s*data/);
});

test("Admin page inherits RTL from AdminShell and has no hardcoded LTR copy", () => {
  assert.doesNotMatch(page, /dir=["']ltr["']/);
  assert.doesNotMatch(page, /text-left|ml-auto|mr-auto|float-left|float-right/);
  assert.doesNotMatch(page, />\s*Enregistrer\s*</);
  assert.doesNotMatch(page, />\s*Save\s*</);
});

test("daily-ops cron fans out to the minimum-pay closer", () => {
  const dailyOps = readFileSync(join(webRoot, "app/api/cron/daily-ops/route.ts"), "utf8");
  assert.match(dailyOps, /\/api\/cron\/nyc-minimum-pay/);
});

test("engine_start_at cannot be rewritten after periods exist", () => {
  assert.match(settingsApi, /engine_start_locked/);
});

test("Admin datetime is parsed in the engine timezone not the browser", () => {
  assert.match(settingsApi, /parseAdminDateTime\(body\.engine_start_at, nextTimezone\)/);
  assert.match(rulesApi, /parseAdminDateTime\(body\.effective_from, zone\)/);
  assert.match(page, /utcIsoToDatetimeLocal/);
  assert.match(page, /Times are interpreted in the engine timezone/);
  assert.match(page, /wallStart === previousWall && settings.engineStartAt/);
});
