import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const host = fs.readFileSync(
  path.join(here, "../components/calls/IncomingMaskedCallHost.tsx"),
  "utf8",
);
const nav = fs.readFileSync(
  path.join(here, "../navigation/AppNavigator.tsx"),
  "utf8",
);
const sentry = fs.readFileSync(path.join(here, "./sentry.ts"), "utf8");
const audio = fs.readFileSync(path.join(here, "./mmdAudio.ts"), "utf8");

assert.match(host, /accessibilityLabel=\{t\("calls.incoming.acceptA11y"/);
assert.match(host, /accessibilityLabel=\{t\("calls.incoming.declineA11y"/);
assert.match(host, /accessibilityLabel=\{t\("calls.connected.endA11y"/);
assert.match(host, /stopLongRing/);
assert.match(host, /\/api\/twilio\/calls\/action/);
assert.match(host, /action: "decline" \| "end"/);
assert.match(host, /postAction\(current\.id, "end"\)/);
assert.match(host, /calls.role.customer/);
assert.match(nav, /IncomingMaskedCallHost/);
assert.match(host, /callSessionsRealtimeFilter/);
assert.match(host, /INCOMING_CALL_POLL_MS/);
assert.match(host, /shouldFetchIncomingCallsOnAuthEvent/);
assert.match(host, /shouldWatchIncomingCalls/);
assert.match(host, /createIncomingCallFetchGate/);
assert.doesNotMatch(host, /setInterval\(\(\) => void load\(userId\), 4000\)/);
assert.match(host, /filter:\s*callSessionsRealtimeFilter\(userId\)/);
assert.doesNotMatch(
  host,
  /table:\s*"call_sessions"[\s\S]{0,80}\(\) => \{\s*void load/,
);
assert.match(sentry, /enableAppHangTracking:\s*true/);
assert.doesNotMatch(sentry, /enableAppHangTracking:\s*false/);
assert.doesNotMatch(sentry, /appHangTimeoutInterval/);
assert.match(audio, /Do not re-enter setAudioModeAsync/);

console.log("incomingMaskedCall.regression.test.ts OK");
