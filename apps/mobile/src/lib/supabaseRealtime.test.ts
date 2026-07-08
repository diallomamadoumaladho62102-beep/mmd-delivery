import assert from "node:assert/strict";
import { uniqueChannelNameForTest } from "./supabaseRealtime.testHelpers";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("unique channel names avoid postgres callback reuse collisions", () => {
  const a = uniqueChannelNameForTest("client-home");
  const b = uniqueChannelNameForTest("client-home");
  assert.notEqual(a, b);
  assert.match(a, /^client-home:/);
});

console.log("supabaseRealtime tests passed");
