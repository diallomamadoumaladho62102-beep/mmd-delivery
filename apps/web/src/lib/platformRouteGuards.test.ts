import assert from "node:assert/strict";
import { orderVerticalForPlatformGate } from "./platformRouteGuards";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("orderVerticalForPlatformGate maps food to restaurant", () => {
  assert.equal(orderVerticalForPlatformGate("food"), "restaurant");
});

test("orderVerticalForPlatformGate maps errand to delivery", () => {
  assert.equal(orderVerticalForPlatformGate("errand"), "delivery");
});

console.log("platformRouteGuards tests passed");
