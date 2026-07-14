import assert from "node:assert/strict";
import {
  filterActiveTaxiOffers,
  formatOfferCountdown,
  isTaxiOfferExpired,
} from "./taxiOfferExpiry";

function testFilterExpired() {
  const now = Date.parse("2026-07-14T12:00:00.000Z");
  const offers = [
    { id: "a", expires_at: "2026-07-14T12:01:00.000Z" },
    { id: "b", expires_at: "2026-07-14T11:59:00.000Z" },
    { id: "c", expires_at: null },
  ];
  const active = filterActiveTaxiOffers(offers, now);
  assert.deepEqual(
    active.map((o) => o.id),
    ["a", "c"]
  );
  assert.equal(isTaxiOfferExpired(offers[1], now), true);
  assert.equal(isTaxiOfferExpired(offers[0], now), false);
}

function testCountdown() {
  const now = Date.parse("2026-07-14T12:00:00.000Z");
  assert.equal(formatOfferCountdown("2026-07-14T11:00:00.000Z", now), "Expired");
  assert.equal(formatOfferCountdown("2026-07-14T12:00:45.000Z", now), "45s left");
  assert.equal(formatOfferCountdown("2026-07-14T12:02:05.000Z", now), "2m 5s left");
}

testFilterExpired();
testCountdown();

console.log("taxiOfferExpiry.test.ts OK");
