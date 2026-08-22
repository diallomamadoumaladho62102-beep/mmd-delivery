import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const auth = fs.readFileSync(
  path.join(here, "../screens/RestaurantAuthScreen.tsx"),
  "utf8",
);

assert.match(auth, /AUTH_ACTION_TIMEOUT_MS/);
assert.match(auth, /restaurant_signIn/);
assert.match(auth, /restaurant_signUp/);
assert.match(auth, /restaurant_resetPassword/);
assert.match(auth, /resetPasswordForEmail/);
assert.match(auth, /validatePassword/);
assert.match(auth, /setLoading\(true\)/);
assert.match(auth, /setLoading\(false\)/);
assert.doesNotMatch(auth, /routing_number|account_number|iban/i);

console.log("restaurantAuthTimeouts.test.ts OK");
