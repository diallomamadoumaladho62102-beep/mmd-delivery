import test from "node:test";
import assert from "node:assert/strict";
import {
  formatDistance,
  formatDurationMinutes,
  formatMoneyFromCents,
  formatTripDurationFromSeconds,
  intlLocaleTag,
} from "@/i18n/formatters";

test("web formatters match mobile semantics for money and distance", () => {
  assert.equal(intlLocaleTag("fr"), "fr-FR");
  const usd = formatMoneyFromCents(1050, "USD", "en");
  assert.match(usd, /10\.50|\$10\.50/);

  const miles = formatDistance(2, "en");
  assert.match(miles, /mi|mile/i);

  const km = formatDistance(2, "fr");
  assert.match(km, /km/i);

  const mins = formatDurationMinutes(45, "en");
  assert.match(mins, /45 min 00 sec/);
  assert.equal(formatTripDurationFromSeconds(3180), "53 min 00 sec");
  assert.equal(formatTripDurationFromSeconds(3600), "1 h 00 min 00 sec");
  assert.equal(formatTripDurationFromSeconds(7380), "2 h 03 min 00 sec");
});
