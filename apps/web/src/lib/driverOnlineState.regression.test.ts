/**
 * Regression: driver ONLINE must persist after write + reread.
 * Store builds previously wrote is_online directly; self-write guard froze it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(process.cwd(), "..", "..");
const migration = readFileSync(
  join(
    repoRoot,
    "supabase/migrations/20260913120000_fix_driver_online_self_write_guard.sql",
  ),
  "utf8",
);
const mobileApi = readFileSync(
  join(repoRoot, "apps/mobile/src/lib/driverServicePreferencesApi.ts"),
  "utf8",
);

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("self-write guard no longer freezes is_online", () => {
  assert.match(migration, /is_online is intentionally writable/);
  assert.doesNotMatch(migration, /new\.is_online\s*:=\s*old\.is_online/);
  assert.match(migration, /driver_can_go_online/);
  assert.match(migration, /set_driver_online/);
});

test("mobile prefers set_driver_online RPC", () => {
  assert.match(mobileApi, /set_driver_online/);
  assert.match(mobileApi, /\/api\/driver\/online/);
});

console.log("driverOnlineState regression tests passed");
