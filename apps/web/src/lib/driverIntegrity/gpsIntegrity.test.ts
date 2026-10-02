import assert from "node:assert/strict";
import test from "node:test";
import { haversineMeters, speedMetersPerSecond } from "./gpsIntegrity";
import { parseWaitReasonCode } from "./waitReasons";
import { clientCannotWriteOfficialClock } from "./timestampGuards";

test("haversine and speed handle GPS samples", () => {
  const a = { lat: 40.758, lng: -73.9855, atMs: 0 };
  const b = { lat: 40.761, lng: -73.9855, atMs: 60_000 };
  const meters = haversineMeters(a, b);
  assert.ok(meters != null && meters > 200 && meters < 500);
  const speed = speedMetersPerSecond(a, b);
  assert.ok(speed != null && speed > 0 && speed < 20);
});

test("invalid GPS coordinates are ignored", () => {
  assert.equal(haversineMeters({ lat: 999, lng: 0 }, { lat: 0, lng: 0 }), null);
});

test("wait reason parser rejects forged codes", () => {
  assert.equal(parseWaitReasonCode("fraud"), null);
  assert.equal(parseWaitReasonCode("restaurant_delay"), "restaurant_delay");
});

test("client payload cannot write official clock fields", () => {
  assert.equal(
    clientCannotWriteOfficialClock({
      driverAcceptedAt: null,
      earnings: null,
      reviewDecision: null,
    }),
    true
  );
  assert.equal(
    clientCannotWriteOfficialClock({ driverAcceptedAt: "2026-01-01T00:00:00Z" }),
    false
  );
});
