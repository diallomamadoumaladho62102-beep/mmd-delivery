import assert from "node:assert/strict";
import {
  RESTAURANT_HOME_NAV,
  RESTAURANT_MAP_STATUS_FILTERS,
} from "./restaurantHomeNav";

const keys = RESTAURANT_HOME_NAV.map((item) => item.key);
assert.ok(keys.includes("home"));
assert.ok(keys.includes("orders"));
assert.ok(keys.includes("menu"));
assert.ok(keys.includes("tax"));
assert.ok(keys.includes("security"));
assert.ok(keys.includes("language"));
assert.ok(keys.includes("ai"));
assert.ok(!keys.includes("clients" as never));
assert.ok(!keys.includes("reviews" as never));

const filterKeys = RESTAURANT_MAP_STATUS_FILTERS.map((f) => f.key);
assert.deepEqual(filterKeys, ["all", "pending", "accepted", "prepared", "ready"]);

const drivers = RESTAURANT_HOME_NAV.find((i) => i.key === "drivers");
assert.equal(drivers?.toggle, "drivers");

console.log("restaurantHomeNav.test.ts OK");
