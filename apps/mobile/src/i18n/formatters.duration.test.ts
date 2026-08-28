import assert from "node:assert/strict";
import {
  formatTripDurationFromSeconds,
  formatDurationMinutes,
  resolveRouteDurationSeconds,
} from "./formatTripDuration";

assert.equal(formatTripDurationFromSeconds(3180), "53 min 00 sec");
assert.equal(formatTripDurationFromSeconds(3600), "1 h 00 min 00 sec");
assert.equal(formatTripDurationFromSeconds(7380), "2 h 03 min 00 sec");
assert.equal(formatTripDurationFromSeconds(45), "0 min 45 sec");
assert.equal(formatTripDurationFromSeconds(0), "0 min 00 sec");
assert.equal(formatTripDurationFromSeconds(null), "—");
assert.equal(formatTripDurationFromSeconds(undefined), "—");
assert.equal(formatTripDurationFromSeconds(Number.NaN), "—");
assert.equal(formatTripDurationFromSeconds(-12), "—");

assert.equal(formatDurationMinutes(53), "53 min 00 sec");
assert.equal(formatDurationMinutes(60), "1 h 00 min 00 sec");
assert.equal(formatDurationMinutes(123), "2 h 03 min 00 sec");
// Raw Mapbox seconds mistakenly stored as minutes must not render as hours.
assert.equal(formatDurationMinutes(3180), "53 min 00 sec");
assert.equal(formatDurationMinutes(14400), "4 h 00 min 00 sec");

assert.equal(resolveRouteDurationSeconds({ durationSeconds: 3180 }), 3180);
assert.equal(resolveRouteDurationSeconds({ durationMinutes: 53 }), 3180);
assert.equal(resolveRouteDurationSeconds({ durationMinutes: 3180 }), 3180);
assert.equal(resolveRouteDurationSeconds({}), null);

const formatted = formatTripDurationFromSeconds(3180);
assert.doesNotMatch(formatted, /\d+s\b/);
assert.doesNotMatch(formatted, /,/);

console.log("formatTripDuration.test.ts OK");
