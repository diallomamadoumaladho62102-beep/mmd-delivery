import assert from "node:assert/strict";
import {
  accountInactiveApiError,
  accountStatusBlockMessage,
  isAccountActive,
  normalizeAccountStatus,
} from "./accountStatus";

assert.equal(isAccountActive("active"), true);
assert.equal(isAccountActive(null), true);
assert.equal(isAccountActive("suspended"), false);
assert.equal(isAccountActive("disabled"), false);
assert.equal(isAccountActive("deleted"), false);
assert.equal(isAccountActive("banned"), false);
assert.equal(isAccountActive("unknown"), false);
assert.equal(normalizeAccountStatus("DELETED"), "deleted");
assert.equal(normalizeAccountStatus("banned"), "banned");
assert.ok(accountStatusBlockMessage("suspended"));
assert.ok(accountStatusBlockMessage("deleted"));
assert.ok(accountStatusBlockMessage("banned"));
assert.equal(accountStatusBlockMessage("active"), null);
assert.equal(accountInactiveApiError("suspended").code, "ACCOUNT_INACTIVE");

console.log("accountStatus.test.ts OK");
