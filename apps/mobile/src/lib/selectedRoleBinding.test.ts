import assert from "node:assert/strict";
import { roleVisibleToUser } from "./selectedRoleBinding";

const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const stolen = roleVisibleToUser({
  storedRole: "driver",
  storedUserId: userA,
  currentUserId: userB,
});
assert.equal(stolen.role, null);
assert.equal(stolen.clear, true);

const own = roleVisibleToUser({
  storedRole: "client",
  storedUserId: userB,
  currentUserId: userB,
});
assert.equal(own.role, "client");
assert.equal(own.clear, false);

const firstBind = roleVisibleToUser({
  storedRole: "seller",
  storedUserId: null,
  currentUserId: userB,
});
assert.equal(firstBind.role, "seller");
assert.equal(firstBind.bindUserId, userB);

console.log("selectedRoleBinding.test.ts — PASS");
