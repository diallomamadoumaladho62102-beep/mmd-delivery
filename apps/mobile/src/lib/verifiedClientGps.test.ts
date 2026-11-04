import assert from "node:assert/strict";
import {
  isGuineaMapCameraDefault,
  verifiedGpsUserMessage,
} from "./verifiedClientGpsPure";

assert.equal(isGuineaMapCameraDefault(9.6412, -13.5784), true);
assert.equal(isGuineaMapCameraDefault(9.6412 + 0.01, -13.5784), false);
assert.equal(isGuineaMapCameraDefault(11.3181, -12.2832), false);

const msg = verifiedGpsUserMessage({
  ok: false,
  code: "services_off",
  messageKey: "gps.servicesOff",
  messageDefault: "x",
  accuracyM: null,
  ageMs: null,
});
assert.match(msg.defaultValue, /GPS/i);

console.log("verifiedClientGps.test.ts OK");
