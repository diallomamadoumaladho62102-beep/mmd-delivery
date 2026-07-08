import assert from "node:assert/strict";
import test from "node:test";
import {
  hasPhoneChangedSinceVerification,
  normalizeIdentityPhone,
} from "./driverIdentityService";

test("normalizeIdentityPhone strips non-digits", () => {
  assert.equal(normalizeIdentityPhone("+1 (555) 123-4567"), "15551234567");
});

test("hasPhoneChangedSinceVerification ignores profile updated_at-only changes", () => {
  assert.equal(
    hasPhoneChangedSinceVerification(
      "+1 555 123 4567",
      "+1 555 123 4567",
      new Date().toISOString(),
    ),
    false,
  );
});

test("hasPhoneChangedSinceVerification detects real phone changes", () => {
  assert.equal(
    hasPhoneChangedSinceVerification(
      "+1 555 999 0000",
      "+1 555 123 4567",
      new Date().toISOString(),
    ),
    true,
  );
});

test("hasPhoneChangedSinceVerification is false without verification baseline", () => {
  assert.equal(hasPhoneChangedSinceVerification("+1 555 123 4567", null, null), false);
});

console.log("driverIdentityPhone.test.ts OK");
