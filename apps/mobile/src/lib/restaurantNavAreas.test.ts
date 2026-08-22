import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const nav = fs.readFileSync(
  path.join(here, "../navigation/AppNavigator.tsx"),
  "utf8",
);

const clientStart = nav.indexOf("const isInClientArea");
const driverStart = nav.indexOf("const isInDriverArea");
const restaurantStart = nav.indexOf("const isInRestaurantArea");
assert.ok(clientStart > 0 && driverStart > clientStart && restaurantStart > driverStart);

const clientArea = nav.slice(clientStart, driverStart);
const restaurantArea = nav.slice(restaurantStart, restaurantStart + 1800);

assert.doesNotMatch(
  clientArea,
  /r === "RestaurantWallet"/,
  "RestaurantWallet must not be treated as a client screen",
);
assert.match(restaurantArea, /r === "RestaurantWallet"/);
assert.match(restaurantArea, /r === "RestaurantEarnings"/);
assert.match(restaurantArea, /r === "RestaurantFinancialCenter"/);
assert.match(nav, /if \(!session\)[\s\S]*resetTo\("RoleSelect"\)/);

console.log("restaurantNavAreas.test.ts OK");
