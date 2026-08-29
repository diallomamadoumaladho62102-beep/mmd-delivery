import assert from "node:assert/strict";
import { pickMaskedCallSession } from "./twilioMaskedSessionMatch";

const now = Date.parse("2026-08-29T12:00:00.000Z");
const later = "2026-08-29T13:00:00.000Z";

const a = {
  id: "a",
  caller_phone: "+15551110001",
  proxy_number: "+15550000000",
  status: "active",
  created_at: "2026-08-29T11:00:00.000Z",
  expires_at: later,
};

const b = {
  id: "b",
  caller_phone: "+15551110001",
  proxy_number: "+15550000000",
  status: "active",
  created_at: "2026-08-29T11:30:00.000Z",
  expires_at: later,
};

const unique = pickMaskedCallSession({
  sessions: [a],
  from: "+15551110001",
  to: "+15550000000",
  nowMs: now,
});
assert.equal(unique.ok, true);
if (unique.ok) assert.equal(unique.session.id, "a");

const collision = pickMaskedCallSession({
  sessions: [a, b],
  from: "+15551110001",
  to: "+15550000000",
  nowMs: now,
});
assert.equal(collision.ok, false);
if (collision.ok === false) assert.equal(collision.reason, "ambiguous");

const bySid = pickMaskedCallSession({
  sessions: [
    { ...a, twilio_call_sid: "CA111" },
    { ...b, twilio_call_sid: "CA222" },
  ],
  from: "+15551110001",
  callSid: "CA222",
  nowMs: now,
});
assert.equal(bySid.ok, true);
if (bySid.ok) assert.equal(bySid.session.id, "b");

const none = pickMaskedCallSession({
  sessions: [a],
  from: "+15559999999",
  nowMs: now,
});
assert.equal(none.ok, false);

console.log("twilioMaskedSessionMatch.test.ts OK");
