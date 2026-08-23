import assert from "node:assert/strict";
import { filterNavGroups, ADMIN_NAV_GROUPS } from "./adminNav";
import {
  hasPermission,
  type AdminPermission,
  type StaffRole,
} from "./adminRbac";
import { ADMIN_HUB_LINKS } from "./adminHubLinks";
import { NAV_ICONS } from "@/components/admin/adminUi";

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

test("Taxi Pricing appears in Finance for founder and finance_admin", () => {
  const founder = navHrefs("super_admin", true);
  assert.equal(
    founder.includes("/admin/taxi-pricing"),
    true,
    "founder should see Taxi Pricing",
  );
  const finance = navHrefs("finance_admin", false);
  assert.equal(
    finance.includes("/admin/taxi-pricing"),
    true,
    "finance_admin has taxi_pricing.read",
  );
});

test("Taxi Pricing sits in Finance after Pricing with taxi_pricing.read", () => {
  const finance = ADMIN_NAV_GROUPS.find((g) => g.id === "finance");
  assert.ok(finance, "finance group exists");
  const hrefs = finance!.items.map((i) => i.href);
  const pricingIdx = hrefs.indexOf("/admin/pricing");
  const taxiIdx = hrefs.indexOf("/admin/taxi-pricing");
  assert.ok(pricingIdx >= 0, "Pricing present");
  assert.ok(taxiIdx >= 0, "Taxi Pricing present");
  assert.ok(taxiIdx === pricingIdx + 1, "Taxi Pricing immediately after Pricing");
  const item = finance!.items[taxiIdx]!;
  assert.equal(item.label, "Taxi Pricing");
  assert.equal(item.permission, "taxi_pricing.read");
});

test("Taxi Pricing is hidden without taxi_pricing.read", () => {
  const groups = filterNavGroups({
    role: "operations_admin",
    isFounder: false,
    hasPermission: (permission) =>
      permission === "hub.access" ||
      permission === "orders.read" ||
      permission === "pricing.read",
  });
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  assert.equal(hrefs.includes("/admin/taxi-pricing"), false);
});

test("Taxi Monitoring appears in Launch for founder", () => {
  const hrefs = navHrefs("super_admin", true);
  assert.equal(hrefs.includes("/admin/taxi-monitoring"), true);
});

test("every sidebar nav href has an icon mapping", () => {
  const missing: string[] = [];
  for (const group of ADMIN_NAV_GROUPS) {
    for (const item of group.items) {
      if (!NAV_ICONS[item.href]) missing.push(item.href);
    }
  }
  assert.deepEqual(missing, [], `missing icons: ${missing.join(", ")}`);
});

test("hub Taxi Pricing link stays aligned with sidebar", () => {
  const hub = ADMIN_HUB_LINKS.find((l) => l.href === "/admin/taxi-pricing");
  assert.ok(hub, "hub includes Taxi Pricing");
  assert.equal(hub!.permission, "taxi_pricing.read");
  assert.equal(
    navHrefs("super_admin", true).includes("/admin/taxi-pricing"),
    true,
  );
});

console.log("adminNav tests passed");
