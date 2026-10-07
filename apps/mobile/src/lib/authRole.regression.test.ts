import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shouldClearPrivateDeviceState } from "./selectedRoleBinding";

assert.equal(shouldClearPrivateDeviceState(null, "user-b"), false);
assert.equal(shouldClearPrivateDeviceState("user-a", "user-a"), false);
assert.equal(shouldClearPrivateDeviceState("user-a", "user-b"), true);
assert.equal(shouldClearPrivateDeviceState("  ", "user-b"), false);

const source = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "authRole.ts"),
  "utf8",
);
assert.match(source, /clearUserPrivateDeviceState/);
assert.match(source, /mmd_driver_is_online/);
assert.match(source, /clearAiLocalHistory/);

console.log("auth role device isolation regression passed");
