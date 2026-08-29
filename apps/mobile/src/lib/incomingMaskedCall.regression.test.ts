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

assert.match(host, /accessibilityLabel=\{t\("calls.incoming.acceptA11y"/);
assert.match(host, /accessibilityLabel=\{t\("calls.incoming.declineA11y"/);
assert.match(host, /accessibilityLabel=\{t\("calls.connected.endA11y"/);
assert.match(host, /stopLongRing/);
assert.match(host, /\/api\/twilio\/calls\/action/);
assert.match(host, /action: "decline" \| "end"/);
assert.match(host, /postAction\(current\.id, "end"\)/);
assert.match(host, /calls.role.customer/);
assert.match(nav, /IncomingMaskedCallHost/);

console.log("incomingMaskedCall.regression.test.ts OK");
