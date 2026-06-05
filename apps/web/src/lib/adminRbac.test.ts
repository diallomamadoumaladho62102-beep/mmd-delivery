import assert from "node:assert/strict";
import { hasPermission, isSuperAdmin, STAFF_ROLES } from "./adminRbac";

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
  assert.equal(isSuperAdmin("admin"), true);
  assert.equal(hasPermission("admin", "pricing.write"), true);
  assert.equal(hasPermission("admin", "users.admins.manage"), true);
  assert.equal(hasPermission("admin", "payouts.retry"), true);
});

test("ops cannot modify pricing or admins", () => {
  assert.equal(hasPermission("ops", "dispatch.manage"), true);
  assert.equal(hasPermission("ops", "users.clients.manage"), true);
  assert.equal(hasPermission("ops", "pricing.write"), false);
  assert.equal(hasPermission("ops", "users.admins.manage"), false);
  assert.equal(hasPermission("ops", "payouts.read"), false);
});

test("support cannot manage clients", () => {
  assert.equal(hasPermission("support", "users.clients.read"), true);
  assert.equal(hasPermission("support", "users.clients.manage"), false);
  assert.equal(hasPermission("support", "communication.notify"), true);
});

test("finance cannot manage users or dispatch", () => {
  assert.equal(hasPermission("finance", "payments.read"), true);
  assert.equal(hasPermission("finance", "commissions.read"), true);
  assert.equal(hasPermission("finance", "users.clients.read"), false);
  assert.equal(hasPermission("finance", "dispatch.manage"), false);
});

test("support can view but not manage payouts or pricing", () => {
  assert.equal(hasPermission("support", "orders.read"), true);
  assert.equal(hasPermission("support", "communication.chats"), true);
  assert.equal(hasPermission("support", "users.drivers.read"), true);
  assert.equal(hasPermission("support", "users.drivers.manage"), false);
  assert.equal(hasPermission("support", "payouts.read"), false);
  assert.equal(hasPermission("support", "pricing.read"), false);
});

test("review admin is limited to driver/restaurant manage", () => {
  assert.equal(hasPermission("review", "users.drivers.manage"), true);
  assert.equal(hasPermission("review", "users.restaurants.manage"), true);
  assert.equal(hasPermission("review", "orders.read"), false);
  assert.equal(hasPermission("review", "hub.access"), true);
});

test("staff roles are closed set", () => {
  assert.equal(STAFF_ROLES.length, 5);
  assert.equal(hasPermission("client", "hub.access"), false);
});

console.log("adminRbac tests passed");
