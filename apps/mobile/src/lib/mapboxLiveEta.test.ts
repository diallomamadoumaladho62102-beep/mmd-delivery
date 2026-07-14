import assert from "node:assert/strict";
import {
  clearLiveEtaCache,
  createLiveEtaSession,
  etaFromHaversine,
  getLiveEtaCacheEntry,
  haversineLiveEta,
  haversineMeters,
  haversineMiles,
  liveEtaCacheKey,
  LIVE_ETA_CACHE_TTL_MS,
  LIVE_ETA_MIN_INTERVAL_MS,
  roundCoordKey,
  setLiveEtaCacheForTest,
  shouldThrottleLiveEtaNetwork,
  markLiveEtaNetwork,
} from "./mapboxLiveEtaCore";

function testHaversineKnownDistance() {
  const a = { latitude: 40.7128, longitude: -74.006 };
  const b = { latitude: 40.6782, longitude: -73.9442 };
  const meters = haversineMeters(a, b);
  assert.ok(meters > 5000 && meters < 12000, `unexpected meters ${meters}`);
  const miles = haversineMiles(a, b);
  assert.ok(Math.abs(miles - meters / 1609.344) < 1e-9);
}

function testEtaFromHaversine() {
  assert.equal(etaFromHaversine(0), 1);
  assert.equal(etaFromHaversine(-10), 1);
  assert.equal(etaFromHaversine(8300, 8.3), 17);
}

function testHaversineFallbackShape() {
  const from = { latitude: 40.7, longitude: -74.0 };
  const to = { latitude: 40.71, longitude: -73.99 };
  const result = haversineLiveEta(from, to);
  assert.equal(result.source, "haversine");
  assert.equal(result.geometry, null);
  assert.ok(result.etaMinutes >= 1);
  assert.ok(result.distanceMeters > 0);
}

function testCacheKeyRounding() {
  const a = { latitude: 40.71284, longitude: -74.00601 };
  const b = { latitude: 40.71281, longitude: -74.00602 };
  assert.equal(roundCoordKey(a), roundCoordKey(b));
  assert.equal(
    liveEtaCacheKey(a, { latitude: 40.72, longitude: -74.01 }),
    liveEtaCacheKey(b, { latitude: 40.72, longitude: -74.01 })
  );
}

function testSessionGeneration() {
  const session = createLiveEtaSession();
  const g1 = session.nextGeneration();
  const g2 = session.nextGeneration();
  assert.equal(session.isCurrent(g1), false);
  assert.equal(session.isCurrent(g2), true);
}

function testThrottleAndCache() {
  clearLiveEtaCache();
  const key = "throttle-key";
  const value = haversineLiveEta(
    { latitude: 1, longitude: 1 },
    { latitude: 1.01, longitude: 1.01 }
  );
  setLiveEtaCacheForTest(key, value, Date.now());
  markLiveEtaNetwork(key, Date.now());
  assert.equal(shouldThrottleLiveEtaNetwork(key), true);
  assert.ok(getLiveEtaCacheEntry(key));
  assert.ok(LIVE_ETA_CACHE_TTL_MS >= 15_000);
  assert.ok(LIVE_ETA_MIN_INTERVAL_MS >= 5_000);
  clearLiveEtaCache();
  assert.equal(getLiveEtaCacheEntry(key), undefined);
}

testHaversineKnownDistance();
testEtaFromHaversine();
testHaversineFallbackShape();
testCacheKeyRounding();
testSessionGeneration();
testThrottleAndCache();

console.log("mapboxLiveEta.test.ts OK");
