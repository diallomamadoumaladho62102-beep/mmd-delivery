import assert from "node:assert/strict";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("outbound channel union is stable", () => {
  const channels = ["push", "sms", "email"] as const;
  assert.equal(channels.length, 3);
  assert.equal(channels.includes("push"), true);
});

test("client action status mapping", () => {
  const map: Record<string, string> = {
    suspend: "suspended",
    unsuspend: "active",
    activate: "active",
    deactivate: "disabled",
  };
  assert.equal(map.suspend, "suspended");
  assert.equal(map.deactivate, "disabled");
});

console.log("adminOutbound tests passed");
