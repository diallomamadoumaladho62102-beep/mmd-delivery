import assert from "node:assert/strict";
import {
  CREATABLE_STAFF_ROLES,
  effectiveStaffRole,
  hasPermission,
  isSuperAdmin,
  roleDisplayName,
  STAFF_ROLES,
} from "./adminRbac";
import { sessionHasPermission } from "./adminSessionAccess";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("super admin has all critical permissions", () => {
  assert.equal(isSuperAdmin("super_admin"), true);
  assert.equal(isSuperAdmin("admin"), true);
  assert.equal(hasPermission("super_admin", "pricing.write"), true);
  assert.equal(hasPermission("admin", "users.admins.manage"), true);
  assert.equal(hasPermission("super_admin", "payouts.retry"), true);
  assert.equal(hasPermission("super_admin", "test_records.read"), true);
});

test("non-founder staff cannot read archived/test catalog", () => {
  assert.equal(hasPermission("operations_admin", "test_records.read"), false);
  assert.equal(hasPermission("finance_admin", "test_records.read"), false);
  assert.equal(hasPermission("support_admin", "test_records.read"), false);
  assert.equal(hasPermission("review_admin", "test_records.read"), false);
  // legacy short aliases still resolve
  assert.equal(hasPermission("ops", "test_records.read"), false);
});

test("ops cannot modify pricing or admins", () => {
  assert.equal(hasPermission("operations_admin", "dispatch.manage"), true);
  assert.equal(hasPermission("ops", "users.clients.manage"), true);
  assert.equal(hasPermission("operations_admin", "pricing.write"), false);
  assert.equal(hasPermission("ops", "users.admins.manage"), false);
  assert.equal(hasPermission("ops", "payouts.read"), false);
});

test("support cannot manage clients", () => {
  assert.equal(hasPermission("support_admin", "users.clients.read"), true);
  assert.equal(hasPermission("support", "users.clients.manage"), false);
  assert.equal(hasPermission("support_admin", "communication.notify"), true);
});

test("finance cannot manage users or dispatch", () => {
  assert.equal(hasPermission("finance_admin", "payments.read"), true);
  assert.equal(hasPermission("finance", "commissions.read"), true);
  assert.equal(hasPermission("finance_admin", "users.clients.read"), false);
  assert.equal(hasPermission("finance", "dispatch.manage"), false);
});

test("support can view but not manage payouts or pricing", () => {
  assert.equal(hasPermission("support_admin", "orders.read"), true);
  assert.equal(hasPermission("support", "communication.chats"), true);
  assert.equal(hasPermission("support_admin", "users.drivers.read"), true);
  assert.equal(hasPermission("support", "users.drivers.manage"), false);
  assert.equal(hasPermission("support_admin", "payouts.read"), false);
  assert.equal(hasPermission("support", "pricing.read"), false);
});

test("support finance is lookup-only (no global P&L)", () => {
  assert.equal(
    hasPermission("support_admin", "finance.transactions.lookup"),
    true
  );
  assert.equal(hasPermission("support", "finance.read"), false);
  assert.equal(hasPermission("support_admin", "finance.export"), false);
  assert.equal(hasPermission("support", "finance.transactions.read"), false);
  assert.equal(hasPermission("finance_admin", "finance.read"), true);
  assert.equal(
    hasPermission("finance", "finance.transactions.lookup"),
    true
  );
});

test("review admin is limited to driver/restaurant manage", () => {
  assert.equal(hasPermission("review_admin", "users.drivers.manage"), true);
  assert.equal(hasPermission("review", "users.restaurants.manage"), true);
  assert.equal(hasPermission("review_admin", "orders.read"), false);
  assert.equal(hasPermission("review", "hub.access"), true);
});

test("staff roles are closed set", () => {
  assert.equal(STAFF_ROLES.length, 5);
  assert.equal(hasPermission("client", "hub.access"), false);
});

test("founder flag elevates demoted restaurant role to Super Admin", () => {
  assert.equal(
    effectiveStaffRole({ role: "restaurant", isFounder: true }),
    "super_admin"
  );
  assert.equal(
    effectiveStaffRole({ role: "client", isFounder: true }),
    "super_admin"
  );
  assert.equal(
    effectiveStaffRole({ role: "restaurant", isFounder: false }),
    null
  );
  assert.equal(
    effectiveStaffRole({ role: "ops", isFounder: false }),
    "operations_admin"
  );
  assert.equal(
    effectiveStaffRole({ role: "operations_admin", isFounder: false }),
    "operations_admin"
  );
});

test("roleDisplayName distinguishes Founder from Super Admin", () => {
  assert.equal(roleDisplayName("super_admin"), "Super Admin");
  assert.equal(roleDisplayName("admin"), "Super Admin");
  assert.equal(
    roleDisplayName("super_admin", { isFounder: true }),
    "Fondateur"
  );
  assert.equal(roleDisplayName("operations_admin"), "Operations Admin");
  assert.equal(roleDisplayName("finance_admin"), "Finance Admin");
  assert.equal(roleDisplayName("support_admin"), "Support Admin");
  assert.equal(roleDisplayName("review_admin"), "Review Admin");
});

test("founder session never fails permission checks", () => {
  assert.equal(
    sessionHasPermission(
      { role: "operations_admin", isFounder: true },
      "users.admins.manage"
    ),
    true
  );
  assert.equal(
    sessionHasPermission(
      { role: "ops", isFounder: false },
      "users.admins.manage"
    ),
    false
  );
});

test("only admin manages administrators; support/finance keep scoped perms", () => {
  assert.equal(hasPermission("super_admin", "users.admins.manage"), true);
  assert.equal(hasPermission("support_admin", "users.admins.manage"), false);
  assert.equal(hasPermission("finance_admin", "users.admins.manage"), false);
  assert.equal(hasPermission("support", "marketing.read"), true);
  assert.equal(hasPermission("finance", "marketing.read"), true);
  assert.equal(hasPermission("support_admin", "supervision.read"), true);
  assert.equal(hasPermission("finance_admin", "supervision.read"), true);
  assert.equal(hasPermission("support", "marketing.manage"), false);
  assert.equal(hasPermission("finance", "marketing.manage"), false);
});

test("creatable staff roles include support and finance (canonical)", () => {
  assert.ok(CREATABLE_STAFF_ROLES.includes("support_admin"));
  assert.ok(CREATABLE_STAFF_ROLES.includes("finance_admin"));
  assert.ok(CREATABLE_STAFF_ROLES.includes("operations_admin"));
  assert.ok(CREATABLE_STAFF_ROLES.includes("review_admin"));
  assert.equal(CREATABLE_STAFF_ROLES.includes("super_admin" as never), false);
});

console.log("adminRbac tests passed");
