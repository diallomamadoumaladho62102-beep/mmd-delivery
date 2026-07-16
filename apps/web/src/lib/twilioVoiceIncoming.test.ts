import assert from "node:assert/strict";
import test from "node:test";

import { normalizePhoneE164, phonesEquivalent } from "./phoneE164";

test("incoming lookup matches Twilio From against legacy 10-digit session phone", () => {
  const storedCaller = "9297408722";
  const twilioFrom = "+19297408722";
  assert.equal(phonesEquivalent(storedCaller, twilioFrom), true);
});

test("call session stores canonical E.164", () => {
  assert.equal(normalizePhoneE164("9297408722"), "+19297408722");
});
