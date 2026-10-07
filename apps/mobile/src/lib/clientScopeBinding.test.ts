import assert from "node:assert/strict";
import {
  manualScopeVisibleToUser,
  type StoredClientManualScope,
} from "./clientScopeBinding";

const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let stored: StoredClientManualScope | null = null;

function writeScope(userId: string, countryCode: string) {
  stored = { userId, countryCode, stateCode: "NY", setAt: 1 };
}

function logout() {
  stored = null;
}

function readScope(userId: string) {
  const decision = manualScopeVisibleToUser({
    stored,
    currentUserId: userId,
  });
  if (decision.clear) stored = null;
  return decision.scope;
}

writeScope(userA, "US");
assert.equal(readScope(userA)?.countryCode, "US");
assert.equal(stored?.userId, userA);

logout();
assert.equal(readScope(userB), null);
assert.equal(stored, null);

writeScope(userA, "US");
assert.equal(readScope(userB), null);
assert.equal(stored, null);
assert.equal(readScope(userA), null);

const legacy = manualScopeVisibleToUser({
  stored: { countryCode: "FR", setAt: 2 },
  currentUserId: userB,
});
assert.equal(legacy.scope, null);
assert.equal(legacy.clear, true);

console.log("clientScopeBinding.test.ts — PASS");
