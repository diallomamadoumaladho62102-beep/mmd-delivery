import assert from "node:assert/strict";
import test from "node:test";

import { normalizePhoneE164, phonesEquivalent } from "./phoneE164";

test("normalizePhoneE164 converts 10-digit US numbers", () => {
  assert.equal(normalizePhoneE164("9297408722"), "+19297408722");
});

test("phonesEquivalent matches Twilio From against stored profile", () => {
  assert.equal(phonesEquivalent("9297408722", "+19297408722"), true);
});
