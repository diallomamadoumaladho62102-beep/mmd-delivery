import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const auth = fs.readFileSync(
  path.join(here, "../screens/DriverAuthScreen.tsx"),
  "utf8",
);
const account = fs.readFileSync(
  path.join(here, "../screens/DriverAccountScreen.tsx"),
  "utf8",
);

assert.match(auth, /AUTH_ACTION_TIMEOUT_MS/);
assert.match(auth, /driver_signIn/);
assert.match(auth, /driver_signUp/);
assert.match(auth, /driver_resetPassword/);
assert.match(auth, /driver_boot_getSession/);
assert.match(auth, /driver_getUser/);
assert.match(auth, /driver_route_profile/);
assert.match(auth, /react-native-safe-area-context/);
assert.match(account, /confirmSignOutToRoleSelect/);
assert.match(account, /driverSignOutLabels/);
assert.match(account, /RoleSelect/);

console.log("driverAuthTimeouts.test.ts OK");
