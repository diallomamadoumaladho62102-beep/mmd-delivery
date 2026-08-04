import assert from "node:assert/strict";
import { toCapturableError } from "./toCapturableError";

assert.equal(toCapturableError(new Error("boom")).message, "boom");

const empty = toCapturableError(new Error(""), "driver.wallet.fetchWallet");
assert.equal(empty.message, "driver.wallet.fetchWallet");
assert.equal(empty.name, "Error");

const obj = toCapturableError(
  { ok: false, error: "transport_mode_change_failed", message: "docs required" },
  "driver.api",
);
assert.equal(obj.message, "docs required");
assert.equal(obj.name, "CapturedObjectError");

const codeObj = toCapturableError({ code: "22P02", message: "enum fail" }, "scope");
assert.equal(codeObj.message, "enum fail");
assert.equal(codeObj.name, "22P02");

assert.equal(toCapturableError(null, "fallback").message, "fallback");
assert.equal(toCapturableError("  plain  ").message, "plain");

console.log("toCapturableError.test.ts OK");
