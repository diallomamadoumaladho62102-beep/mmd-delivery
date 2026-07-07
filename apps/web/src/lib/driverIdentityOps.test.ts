import assert from "node:assert/strict";
import {
  evaluateIdentityWaitSla,
  loadIdentityOpsPrefs,
  resolveIdentitySlaTone,
  saveIdentityOpsPrefs,
} from "./driverIdentityDisplay";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("resolveIdentitySlaTone thresholds", () => {
  assert.equal(resolveIdentitySlaTone(10, 30, 120), "ok");
  assert.equal(resolveIdentitySlaTone(45, 30, 120), "warning");
  assert.equal(resolveIdentitySlaTone(150, 30, 120), "critical");
});

test("evaluateIdentityWaitSla returns colored label", () => {
  const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const result = evaluateIdentityWaitSla({
    status: "submitted",
    created_at: twentyMinutesAgo,
    submitted_at: twentyMinutesAgo,
    sla_warning_minutes: 30,
    sla_critical_minutes: 120,
  });
  assert.ok(result);
  assert.equal(result?.tone, "ok");
  assert.match(result?.label ?? "", /20 min/);
});

test("identity ops prefs default to auto advance enabled", () => {
  const prefs = loadIdentityOpsPrefs();
  assert.equal(prefs.autoAdvanceNext, true);
  assert.equal(prefs.fastProcessingMode, false);
  saveIdentityOpsPrefs({ autoAdvanceNext: false, fastProcessingMode: true });
});

console.log("driverIdentityOps tests passed");
