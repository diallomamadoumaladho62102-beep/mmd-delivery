import assert from "node:assert/strict";
import { hasPermission } from "./adminRbac";
import { sessionHasPermission } from "./adminSessionAccess";
import { filterNavGroups } from "./adminNav";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("Founder authorized on every permission string", () => {
  const perms = [
    "hub.access",
    "users.admins.manage",
    "dispatch.manage",
    "finance.export",
    "pricing.write",
    "mmd_ai.manage",
    "test_records.read",
  ] as const;
  for (const p of perms) {
    assert.equal(
      sessionHasPermission({ role: "client", isFounder: true }, p),
      true,
      p
    );
  }
});

test("Super Admin authorized only via role permissions", () => {
  assert.equal(hasPermission("super_admin", "dispatch.manage"), true);
  assert.equal(hasPermission("super_admin", "finance.export"), true);
  assert.equal(
    sessionHasPermission(
      { role: "super_admin", isFounder: false },
      "users.admins.manage"
    ),
    true
  );
});

test("Finance refused on Dispatch", () => {
  assert.equal(hasPermission("finance_admin", "dispatch.read"), false);
  assert.equal(hasPermission("finance_admin", "dispatch.manage"), false);
  const groups = filterNavGroups({
    role: "finance_admin",
    isFounder: false,
    hasPermission: (p) => hasPermission("finance_admin", p),
  });
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  assert.equal(hrefs.includes("/admin/dispatch"), false);
});

test("Ops (dispatch) refused on Finance hub modules", () => {
  assert.equal(hasPermission("operations_admin", "finance.export"), false);
  assert.equal(hasPermission("operations_admin", "payouts.retry"), false);
  const groups = filterNavGroups({
    role: "operations_admin",
    isFounder: false,
    hasPermission: (p) => hasPermission("operations_admin", p),
  });
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  assert.equal(hrefs.includes("/admin/commission-engine"), false);
});

test("Support limited to its modules", () => {
  assert.equal(hasPermission("support_admin", "communication.chats"), true);
  assert.equal(hasPermission("support_admin", "users.admins.manage"), false);
  assert.equal(hasPermission("support_admin", "pricing.write"), false);
  assert.equal(hasPermission("support_admin", "dispatch.manage"), false);
});

test("non-admin user refused", () => {
  assert.equal(hasPermission("client", "hub.access"), false);
  assert.equal(hasPermission("driver", "hub.access"), false);
  assert.equal(hasPermission("restaurant", "hub.access"), false);
  assert.equal(hasPermission(null, "hub.access"), false);
  assert.equal(
    sessionHasPermission({ role: "client", isFounder: false }, "hub.access"),
    false
  );
});

test("client-forged founder flag without server isFounder is meaningless for role perms", () => {
  assert.equal(hasPermission("client", "users.admins.manage"), false);
  assert.equal(
    sessionHasPermission(
      { role: "finance_admin", isFounder: false },
      "dispatch.manage"
    ),
    false
  );
});

test("Founder nav includes Staff, Teams, Tasks, People Ops", () => {
  const groups = filterNavGroups({
    role: "super_admin",
    isFounder: true,
    hasPermission: () => false,
  });
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  for (const href of [
    "/admin/staff",
    "/admin/teams",
    "/admin/tasks",
    "/admin/hr",
  ]) {
    assert.equal(hrefs.includes(href), true, href);
  }
});

console.log("adminFounderBypass tests passed");
