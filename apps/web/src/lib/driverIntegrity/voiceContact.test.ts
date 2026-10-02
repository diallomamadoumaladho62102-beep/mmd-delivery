import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toPublicMaskedCallSession } from "../publicMaskedCallSession";
import { voiceContactNeverExposesDriverPhone } from "./voiceContact";

const src = readFileSync(join(process.cwd(), "src/lib/driverIntegrity/voiceContact.ts"), "utf8");
const route = readFileSync(
  join(process.cwd(), "app/api/admin/driver-integrity/contact/route.ts"),
  "utf8"
);
const page = readFileSync(join(process.cwd(), "app/admin/driver-integrity/page.tsx"), "utf8");
const create = readFileSync(join(process.cwd(), "app/api/twilio/calls/create/route.ts"), "utf8");
const incoming = readFileSync(join(process.cwd(), "src/lib/twilioVoiceIncoming.ts"), "utf8");

test("masked call architecture is session + tel:proxy + inbound bridge", () => {
  assert.match(create, /proxyNumber: MMD_TWILIO_NUMBER/);
  assert.match(create, /toPublicMaskedCallSession/);
  assert.match(incoming, /handleTwilioVoiceIncoming/);
  assert.match(src, /result: "ready_to_dial"/);
  assert.match(src, /result: "duplicate"/);
  assert.doesNotMatch(src, /result: "initiated"/);
  assert.doesNotMatch(src, /calls\.create/);
  assert.match(page, /tel:\$\{proxy\}/);
  assert.match(route, /proxy_number/);
  assert.match(route, /ok: false/);
});

test("public session strips driver and admin phones", () => {
  const pub = toPublicMaskedCallSession(
    {
      id: "s1",
      order_id: "o1",
      caller_role: "admin",
      target_role: "driver",
      status: "active",
      proxy_number: "+15551212",
      caller_phone: "+15550001111",
      target_phone: "+15550002222",
    },
    "+15551212"
  );
  assert.equal(pub?.proxy_number, "+15551212");
  assert.equal("target_phone" in (pub ?? {}), false);
  assert.equal("caller_phone" in (pub ?? {}), false);
  assert.equal(voiceContactNeverExposesDriverPhone(), true);
  assert.doesNotMatch(route, /target_phone/);
  assert.doesNotMatch(route, /caller_phone/);
});

test("voice failure is not recorded as a completed call", () => {
  assert.match(src, /proxy_unavailable/);
  assert.match(src, /admin_phone_unavailable/);
  assert.match(src, /driver_phone_unavailable/);
  assert.match(route, /started\.ok/);
  assert.match(route, /voice_failed/);
  assert.match(page, /Unable to start the masked call/);
});

test("duplicate click reuses an active unexpired session", () => {
  assert.match(src, /status", "active"/);
  assert.match(src, /gt\("expires_at"/);
  assert.match(src, /result: "duplicate"/);
});
