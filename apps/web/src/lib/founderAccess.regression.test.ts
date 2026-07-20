/**
 * Regression lock: official founder must keep Super Admin hub.access even if
 * profiles.role was incorrectly demoted (historical failure mode).
 *
 * Official founder: diallomamadoumaladho621@gmail.com
 * user_id: 379cb6a0-2e6e-43f5-b2de-dacac7144c94
 */
import assert from "node:assert/strict";
import { canAccessAdminDashboard } from "./adminAccess";
import { effectiveStaffRole, hasPermission, isSuperAdmin } from "./adminRbac";
import { evaluateStaffLoginAccess } from "./adminStaffLogin";

const OFFICIAL_FOUNDER_EMAIL = "diallomamadoumaladho621@gmail.com";
const OFFICIAL_FOUNDER_USER_ID = "379cb6a0-2e6e-43f5-b2de-dacac7144c94";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("official founder identity constants are stable", () => {
  assert.equal(OFFICIAL_FOUNDER_EMAIL, "diallomamadoumaladho621@gmail.com");
  assert.equal(
    OFFICIAL_FOUNDER_USER_ID,
    "379cb6a0-2e6e-43f5-b2de-dacac7144c94",
  );
});

test("demoted founder still maps to admin for RBAC + login + hub", () => {
  const role = effectiveStaffRole({
    role: "restaurant",
    isFounder: true,
  });
  assert.equal(role, "admin");
  assert.equal(isSuperAdmin(role), true);
  assert.equal(hasPermission(role, "hub.access"), true);
  assert.equal(canAccessAdminDashboard(role), true);

  const login = evaluateStaffLoginAccess({
    role: "restaurant",
    accountStatus: "active",
    isFounder: true,
  });
  assert.equal(login.allowed, true);
  if (login.allowed) assert.equal(login.role, "admin");
});

test("non-founder restaurant never gains hub.access", () => {
  const role = effectiveStaffRole({
    role: "restaurant",
    isFounder: false,
  });
  assert.equal(role, null);
  assert.equal(canAccessAdminDashboard(role), false);
});

console.log("founderAccess regression tests passed");
