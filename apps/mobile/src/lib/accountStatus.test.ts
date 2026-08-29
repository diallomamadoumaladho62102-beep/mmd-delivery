import assert from "node:assert/strict";
import {
  accountStatusBlockMessage,
  isAccountActive,
  normalizeAccountStatus,
} from "./accountStatus";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("deleted is not active", () => {
  assert.equal(normalizeAccountStatus("deleted"), "deleted");
  assert.equal(isAccountActive("deleted"), false);
  assert.equal(isAccountActive("active"), true);
  assert.equal(isAccountActive("suspended"), false);
  assert.equal(isAccountActive("disabled"), false);
  assert.equal(isAccountActive("unknown"), false);
  assert.equal(isAccountActive("banned"), false);
});

test("deleted block message is set", () => {
  const msg = accountStatusBlockMessage("deleted");
  assert.ok(msg);
  assert.match(String(msg), /supprim/i);
});

test("active has no block message", () => {
  assert.equal(accountStatusBlockMessage("active"), null);
});

console.log("accountStatus tests passed");
