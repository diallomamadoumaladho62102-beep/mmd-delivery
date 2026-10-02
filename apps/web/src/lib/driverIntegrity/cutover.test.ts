import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { failClosedScanSkipReason } from "./engineGate";
import { cloneDefaultSettings } from "./engineGate";
import { isTimestampOnOrAfterStart } from "../minimumPay/engineGate";

const scan = readFileSync(join(process.cwd(), "src/lib/driverIntegrity/scan.ts"), "utf8");
const earnings = readFileSync(
  join(process.cwd(), "src/lib/minimumPay/recordEarningsLine.ts"),
  "utf8"
);
const migration = readFileSync(
  join(process.cwd(), "../../supabase/migrations/20261208120000_clean_base_cutover_guards.sql"),
  "utf8"
);
const closePay = readFileSync(
  join(process.cwd(), "src/lib/minimumPay/closePayPeriod.ts"),
  "utf8"
);
const activate = readFileSync(
  join(process.cwd(), "../../scripts/activate-real-engines-from-today.sql"),
  "utf8"
);

test("scan requires engine_start_at and excludes test/archived trips", () => {
  const off = cloneDefaultSettings();
  assert.equal(failClosedScanSkipReason(off), "monitoring_disabled");
  assert.equal(
    failClosedScanSkipReason({ ...off, monitoringEnabled: true, engineStartAt: null }),
    "engine_start_required"
  );
  assert.equal(
    failClosedScanSkipReason({
      ...off,
      monitoringEnabled: true,
      engineStartAt: "2026-10-02T12:00:00.000Z",
    }),
    null
  );
  assert.match(scan, /eq\("is_test", false\)/);
  assert.match(scan, /gte\("driver_accepted_at", engineStartAt\)/);
});

test("minimum pay never records test or pre-start earnings", () => {
  assert.match(earnings, /test_source_excluded/);
  assert.match(earnings, /before_engine_start/);
  assert.equal(
    isTimestampOnOrAfterStart(
      { engineStartAt: "2026-10-02T12:00:00.000Z" },
      "2026-10-01T12:00:00.000Z"
    ),
    false
  );
  assert.equal(
    isTimestampOnOrAfterStart(
      { engineStartAt: "2026-10-02T12:00:00.000Z" },
      "2026-10-02T12:00:00.000Z"
    ),
    true
  );
});

test("cutover migration archives leftover is_test and never deletes Stripe rows", () => {
  assert.match(migration, /is_test, false\) = true/);
  assert.match(migration, /coalesce\(new\.is_test, false\) = true or new\.archived_at is not null/);
  assert.doesNotMatch(migration, /\bdelete from\b/i);
  assert.doesNotMatch(migration, /\btruncate\b/i);
  assert.doesNotMatch(migration, /mode\s*=\s*'active'/);
  assert.doesNotMatch(migration, /monitoring_enabled\s*=\s*true/);
  assert.match(closePay, /test_or_archived_source/);
  assert.match(activate, /engine_start_at = now\(\)/);
  assert.doesNotMatch(activate, /insert into public\.pay_rule_versions/i);
  assert.doesNotMatch(activate, /mpr_cents_per_hour/);
});
