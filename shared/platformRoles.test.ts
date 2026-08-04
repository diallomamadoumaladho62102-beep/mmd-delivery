import assert from "node:assert/strict";
import {
  PROFILE_ROLES,
  STAFF_ROLES,
  normalizeProfileRole,
  normalizeStaffRole,
  roleDisplayName,
} from "./platformRoles";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("legacy short staff aliases normalize to canonical long form", () => {
  assert.equal(normalizeStaffRole("ops"), "operations_admin");
  assert.equal(normalizeStaffRole("finance"), "finance_admin");
  assert.equal(normalizeStaffRole("support"), "support_admin");
  assert.equal(normalizeStaffRole("review"), "review_admin");
  assert.equal(normalizeStaffRole("admin"), "super_admin");
  assert.equal(normalizeStaffRole("founder"), "super_admin");
});

test("display labels never persist — they normalize to snake_case", () => {
  assert.equal(normalizeStaffRole("Operations Admin"), "operations_admin");
  assert.equal(normalizeStaffRole("Finance Admin"), "finance_admin");
  assert.equal(normalizeStaffRole("Support Admin"), "support_admin");
  assert.equal(normalizeStaffRole("Review Admin"), "review_admin");
  assert.equal(normalizeStaffRole("Super Admin"), "super_admin");
  assert.equal(normalizeStaffRole("finance-admin"), "finance_admin");
  assert.equal(normalizeStaffRole("financeAdmin"), "finance_admin");
});

test("public role aliases", () => {
  assert.equal(normalizeProfileRole("customer"), "client");
  assert.equal(normalizeProfileRole("merchant"), "seller");
  assert.equal(normalizeProfileRole("restaurant_owner"), "restaurant");
});

test("display names for admin dropdown", () => {
  assert.equal(roleDisplayName("operations_admin"), "Operations Admin");
  assert.equal(roleDisplayName("finance_admin"), "Finance Admin");
  assert.equal(roleDisplayName("support_admin"), "Support Admin");
  assert.equal(roleDisplayName("review_admin"), "Review Admin");
  assert.equal(roleDisplayName("super_admin"), "Super Admin");
});

test("every staff role is in PROFILE_ROLES allow-list", () => {
  for (const role of STAFF_ROLES) {
    assert.ok(PROFILE_ROLES.includes(role));
  }
});

console.log("platformRoles tests passed");
