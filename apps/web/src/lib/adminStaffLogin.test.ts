import assert from "node:assert/strict";
import {
  evaluateStaffLoginAccess,
  isValidStaffLoginEmail,
  mapSupabaseSignInError,
  STAFF_LOGIN_DENIED_MESSAGE,
} from "./adminStaffLogin";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("validates staff login email", () => {
  assert.equal(isValidStaffLoginEmail("admin@mmddelivery.com"), true);
  assert.equal(isValidStaffLoginEmail("bad-email"), false);
});

test("maps invalid credentials to French message", () => {
  assert.equal(
    mapSupabaseSignInError("Invalid login credentials"),
    "Email ou mot de passe incorrect.",
  );
});

test("allows authorized staff roles", () => {
  for (const role of ["admin", "ops", "support", "finance", "review"] as const) {
    const result = evaluateStaffLoginAccess({ role, accountStatus: "active" });
    assert.equal(result.allowed, true);
    if (result.allowed) assert.equal(result.role, role);
  }
});

test("rejects client driver and restaurant accounts", () => {
  for (const role of ["client", "driver", "restaurant"] as const) {
    const result = evaluateStaffLoginAccess({ role, accountStatus: "active" });
    assert.equal(result.allowed, false);
    if (!result.allowed) {
      assert.equal(result.message, STAFF_LOGIN_DENIED_MESSAGE);
    }
  }
});

test("rejects suspended staff accounts", () => {
  const result = evaluateStaffLoginAccess({
    role: "ops",
    accountStatus: "suspended",
  });
  assert.equal(result.allowed, false);
  if (!result.allowed) {
    assert.match(result.message, /suspendu/i);
  }
});

console.log("adminStaffLogin tests passed");
