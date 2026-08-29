import assert from "node:assert/strict";
import { assertSafeAppReturnUrl } from "./safeReturnUrl";

assert.equal(assertSafeAppReturnUrl("https://www.mmddelivery.com/identity/return").ok, true);
assert.equal(assertSafeAppReturnUrl("/identity/return").ok, true);
assert.equal(assertSafeAppReturnUrl("mmddelivery://identity/return").ok, true);
assert.equal(assertSafeAppReturnUrl("https://evil.example/phish").ok, false);
assert.equal(assertSafeAppReturnUrl("javascript:alert(1)").ok, false);
assert.equal(assertSafeAppReturnUrl("data:text/html,hi").ok, false);
assert.equal(assertSafeAppReturnUrl("https://google.com").ok, false);
assert.equal(assertSafeAppReturnUrl("//evil.com").ok, false);

const denied = assertSafeAppReturnUrl("https://attacker.test");
assert.equal(denied.ok, false);
if (denied.ok === false) assert.equal(denied.error, "invalid_return_url");

console.log("safeReturnUrl.test.ts OK");
