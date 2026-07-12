import assert from "node:assert";
import {
  createSentryBeforeSend,
  eventSignature,
  isNetworkNoiseMessage,
  isNoiseMessage,
  SENTRY_DENY_URLS,
  SENTRY_IGNORE_ERRORS,
} from "./sentryFilter";

// --- noise detection ---
assert.equal(isNoiseMessage("SyntaxError: Unexpected token in JSON"), true);
assert.equal(isNoiseMessage("invalid_json"), true);
assert.equal(isNoiseMessage("TypeError: cannot read x"), false);

// --- transient network noise is detected (dropped) ---
for (const msg of [
  "TypeError: Failed to fetch",
  "Failed to fetch",
  "NetworkError when attempting to fetch resource",
  "Network request failed",
  "Load failed",
  "The operation was aborted",
  "The user aborted a request",
  "AbortError: The operation was aborted",
  "net::ERR_CONNECTION_RESET",
  "ERR_INTERNET_DISCONNECTED",
  "Request timed out",
  "connection was reset",
]) {
  assert.equal(isNetworkNoiseMessage(msg), true, `network noise: ${msg}`);
  assert.equal(isNoiseMessage(msg), true, `beforeSend noise: ${msg}`);
}

// --- filter stays tight: genuine app errors that merely mention a word are kept ---
for (const msg of [
  "TypeError: cannot read x",
  "Failed to load user dashboard widget",
  "Could not download invoice PDF",
  "Payment intent creation failed",
  "Timed out waiting for driver acceptance",
]) {
  assert.equal(isNetworkNoiseMessage(msg), false, `kept (not network): ${msg}`);
}

// --- network noise is dropped by beforeSend via originalException ---
const netBeforeSend = createSentryBeforeSend({ dedupeWindowMs: 1000 });
assert.equal(
  netBeforeSend({ level: "error" }, { originalException: new TypeError("Failed to fetch") }),
  null,
  "network error dropped by beforeSend",
);

// --- ignore / deny lists populated ---
assert.ok(SENTRY_IGNORE_ERRORS.length > 0, "ignoreErrors populated");
assert.ok(SENTRY_DENY_URLS.some((re) => re.test("chrome://extensions/")), "extension url denied");

// --- beforeSend drops JSON noise ---
const beforeSend = createSentryBeforeSend({ dedupeWindowMs: 1000 });
const jsonNoise = beforeSend(
  { level: "error", exception: { values: [{ type: "SyntaxError", value: "Unexpected end of JSON input" }] } },
  {},
);
assert.equal(jsonNoise, null, "JSON syntax noise dropped");

// --- beforeSend keeps a real error, then de-dupes the identical repeat ---
const realEvent = {
  level: "error",
  exception: {
    values: [
      {
        type: "TypeError",
        value: "Cannot read properties of null (reading 'x')",
        stacktrace: { frames: [{ filename: "app.js", lineno: 42 }] },
      },
    ],
  },
};
const first = beforeSend(realEvent, {});
assert.notEqual(first, null, "real error kept");
const second = beforeSend(realEvent, {});
assert.equal(second, null, "identical repeat de-duplicated within window");

// --- signature differs for different errors ---
const sigA = eventSignature(realEvent, {});
const sigB = eventSignature({ level: "error", message: "other" }, {});
assert.notEqual(sigA, sigB, "distinct signatures");

console.log("sentryFilter tests passed");
