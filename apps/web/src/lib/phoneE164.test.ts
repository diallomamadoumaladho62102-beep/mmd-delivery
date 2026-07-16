import assert from "node:assert/strict";
import test from "node:test";

import {
  maskPhone,
  normalizePhoneE164,
  phonesEquivalent,
} from "./phoneE164";

test("normalizePhoneE164 converts 10-digit US numbers", () => {
  assert.equal(normalizePhoneE164("9297408722"), "+19297408722");
  assert.equal(normalizePhoneE164("(929) 740-8722"), "+19297408722");
});

test("normalizePhoneE164 keeps canonical E.164", () => {
  assert.equal(normalizePhoneE164("+19297408722"), "+19297408722");
  assert.equal(normalizePhoneE164("+1 929 740 8722"), "+19297408722");
});

test("phonesEquivalent matches Twilio From against stored 10-digit profile", () => {
  assert.equal(phonesEquivalent("9297408722", "+19297408722"), true);
  assert.equal(phonesEquivalent("+19297408722", "9297408722"), true);
  assert.equal(phonesEquivalent("9297408722", "+19294924563"), false);
});

test("maskPhone hides middle digits", () => {
  assert.equal(maskPhone("+19297408722"), "***8722");
});
