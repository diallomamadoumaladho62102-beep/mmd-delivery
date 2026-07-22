import assert from "node:assert/strict";
import {
  isAdvertisementLiveNow,
  matchesAdvertisementGeo,
} from "./clientAdvertisements.ts";

const now = "2026-07-22T12:00:00.000Z";

assert.equal(
  isAdvertisementLiveNow({ is_active: true, nowIso: now }),
  true,
  "active unbounded ad is live",
);
assert.equal(
  isAdvertisementLiveNow({
    is_active: true,
    start_date: "2026-07-23T00:00:00.000Z",
    nowIso: now,
  }),
  false,
  "future start is not live",
);
assert.equal(
  isAdvertisementLiveNow({
    is_active: true,
    end_date: "2026-07-21T00:00:00.000Z",
    nowIso: now,
  }),
  false,
  "past end is not live",
);
assert.equal(
  isAdvertisementLiveNow({ is_active: false, nowIso: now }),
  false,
  "inactive is not live",
);

assert.equal(
  matchesAdvertisementGeo({
    adCountry: "US",
    country: "us",
  }),
  true,
  "country match is case-insensitive",
);
assert.equal(
  matchesAdvertisementGeo({
    adCountry: "US",
    country: "FR",
  }),
  false,
  "country mismatch filtered",
);
assert.equal(
  matchesAdvertisementGeo({
    adCity: "Nassau",
    city: null,
  }),
  true,
  "missing client city does not filter",
);
assert.equal(
  matchesAdvertisementGeo({
    adLanguage: "en",
    language: "fr",
  }),
  false,
  "language mismatch filtered",
);

console.log("clientAdvertisements.test.ts OK");
