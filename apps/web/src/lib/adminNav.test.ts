import assert from "node:assert/strict";
import { filterNavGroups } from "./adminNav";
import {
  hasPermission,
  type AdminPermission,
  type StaffRole,
} from "./adminRbac";
import { ADMIN_HUB_LINKS } from "./adminHubLinks";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

function navHrefs(role: StaffRole, isFounder = false) {
  return filterNavGroups({
    role,
    isFounder,
    hasPermission: (permission: AdminPermission) =>
      hasPermission(role, permission),
  }).flatMap((g) => g.items.map((i) => i.href));
}

test("finance nav excludes dispatch", () => {
  const groups = filterNavGroups({
    role: "finance_admin",
    isFounder: false,
    hasPermission: (permission) =>
      permission === "hub.access" ||
      permission === "finance.read" ||
      permission === "payments.read" ||
      permission === "payouts.read" ||
      permission === "commissions.read" ||
      permission === "pricing.read" ||
      permission === "loyalty.read",
  });
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  assert.equal(hrefs.includes("/admin/dispatch"), false);
  assert.equal(hrefs.includes("/admin/finance"), true);
});

test("founder sees staff administration", () => {
  const groups = filterNavGroups({
    role: "super_admin",
    isFounder: true,
    hasPermission: () => false,
  });
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  assert.equal(hrefs.includes("/admin/staff"), true);
  assert.equal(hrefs.includes("/admin/hr"), true);
});

test("founder sees Administrators, Advertisements and Live Map", () => {
  const hrefs = navHrefs("super_admin", true);
  assert.equal(hrefs.includes("/admin/staff"), true);
  assert.equal(hrefs.includes("/admin/advertisements"), true);
  assert.equal(hrefs.includes("/admin/live-map"), true);
  const hub = ADMIN_HUB_LINKS.map((l) => l.href);
  assert.equal(hub.includes("/admin/staff"), true);
  assert.equal(hub.includes("/admin/advertisements"), true);
  assert.equal(hub.includes("/admin/live-map"), true);
});

test("support and finance see Live Map + ads but not Administrators", () => {
  for (const role of ["support_admin", "finance_admin"] as const) {
    const hrefs = navHrefs(role, false);
    assert.equal(hrefs.includes("/admin/live-map"), true, `${role} live-map`);
    assert.equal(
      hrefs.includes("/admin/advertisements"),
      true,
      `${role} advertisements`
    );
    assert.equal(
      hrefs.includes("/admin/staff"),
      false,
      `${role} must not manage admins`
    );
  }
});

test("ops cannot open Administrators nav", () => {
  const hrefs = navHrefs("operations_admin", false);
  assert.equal(hrefs.includes("/admin/staff"), false);
});

test("Business Accounts appears in Operations for roles with taxi_business.read", () => {
  const ops = navHrefs("operations_admin", false);
  assert.equal(
    ops.includes("/admin/taxi-business-accounts"),
    true,
    "operations_admin should see Business Accounts",
  );
  const founder = navHrefs("super_admin", true);
  assert.equal(
    founder.includes("/admin/taxi-business-accounts"),
    true,
    "founder should see Business Accounts",
  );
});

test("Business Accounts is hidden without taxi_business.read", () => {
  const groups = filterNavGroups({
    role: "finance_admin",
    isFounder: false,
    hasPermission: (permission) =>
      permission === "hub.access" ||
      permission === "finance.read" ||
      permission === "payments.read",
  });
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  assert.equal(hrefs.includes("/admin/taxi-business-accounts"), false);
});

test("Business Accounts nav item uses taxi_business.read and sits in Operations", () => {
  const groups = filterNavGroups({
    role: "operations_admin",
    isFounder: false,
    hasPermission: (p) => hasPermission("operations_admin", p),
  });
  const ops = groups.find((g) => g.id === "operations");
  assert.ok(ops, "operations group exists");
  const item = ops!.items.find((i) => i.href === "/admin/taxi-business-accounts");
  assert.ok(item, "Business Accounts item present");
  assert.equal(item!.label, "Business Accounts");
  assert.equal(item!.permission, "taxi_business.read");
});

console.log("adminNav tests passed");
