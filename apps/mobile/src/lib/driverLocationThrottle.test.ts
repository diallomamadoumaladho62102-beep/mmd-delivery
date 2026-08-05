import assert from "node:assert/strict";
import { distanceMeters } from "./coordinates";

// Mirrors presence/live upsert gates used to cut Disk I/O from GPS spam.
const MIN_INTERVAL_MS = 3000;
const MIN_DISTANCE_M = 10;

function shouldSkipUpsert(params: {
  previous: { at: number; lat: number; lng: number } | null;
  now: number;
  lat: number;
  lng: number;
}): boolean {
  const { previous, now, lat, lng } = params;
  if (!previous) return false;
  if (now - previous.at >= MIN_INTERVAL_MS) return false;
  return distanceMeters(previous.lat, previous.lng, lat, lng) < MIN_DISTANCE_M;
}

{
  const previous = { at: 1_000, lat: 40.7, lng: -74.0 };
  assert.equal(
    shouldSkipUpsert({
      previous,
      now: 1_500,
      lat: 40.700001,
      lng: -74.0,
    }),
    true,
    "near-identical GPS within interval must skip",
  );
  assert.equal(
    shouldSkipUpsert({
      previous,
      now: 5_000,
      lat: 40.700001,
      lng: -74.0,
    }),
    false,
    "after interval, heartbeat upsert allowed",
  );
  assert.equal(
    shouldSkipUpsert({
      previous,
      now: 1_500,
      lat: 40.701,
      lng: -74.0,
    }),
    false,
    "meaningful movement must upsert",
  );
}

console.log("driverLocationThrottle.test.ts OK");
