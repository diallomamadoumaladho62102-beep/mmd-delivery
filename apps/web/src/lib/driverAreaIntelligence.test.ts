import assert from "node:assert/strict";
import {
  buildSmartDispatchCopy,
  clusterHotspots,
  computeAreaIntelligence,
  demandLevelFromRatio,
  earningsMultiplierFromSupplyDemand,
  estimateWaitFromSupplyDemand,
  milesBetween,
} from "./driverAreaIntelligence";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("milesBetween is sane for NYC short hop", () => {
  const m = milesBetween(40.75, -73.99, 40.76, -73.98);
  assert.ok(m > 0.5 && m < 2.5);
});

test("demandLevelFromRatio escalates with scarcity", () => {
  assert.equal(demandLevelFromRatio(0, 5), "calm");
  assert.equal(demandLevelFromRatio(2, 4), "moderate");
  assert.equal(demandLevelFromRatio(5, 4), "busy");
  assert.equal(demandLevelFromRatio(8, 1), "very_busy");
});

test("earningsMultiplier never mocks and stays in [1,2]", () => {
  assert.equal(earningsMultiplierFromSupplyDemand(0, 10), 1);
  const high = earningsMultiplierFromSupplyDemand(12, 1);
  assert.ok(high >= 1.3 && high <= 2.0);
});

test("wait estimate null when offline", () => {
  assert.equal(
    estimateWaitFromSupplyDemand({
      isOnline: false,
      requests: 5,
      drivers: 2,
      nearestMiles: 1,
      hour: 12,
    }),
    null
  );
});

test("wait estimate shrinks when many requests", () => {
  const quiet = estimateWaitFromSupplyDemand({
    isOnline: true,
    requests: 0,
    drivers: 3,
    nearestMiles: null,
    hour: 10,
  });
  const busy = estimateWaitFromSupplyDemand({
    isOnline: true,
    requests: 10,
    drivers: 2,
    nearestMiles: 0.5,
    hour: 12,
  });
  assert.ok(quiet && busy);
  assert.ok(busy!.max < quiet!.max);
});

test("clusterHotspots groups nearby points", () => {
  const hs = clusterHotspots(
    [
      { id: "1", kind: "food", lat: 40.75, lng: -73.99 },
      { id: "2", kind: "food", lat: 40.7505, lng: -73.9905 },
      { id: "3", kind: "taxi", lat: 40.8, lng: -73.95 },
    ],
    { lat: 40.75, lng: -73.99 },
    2
  );
  assert.ok(hs.length >= 2);
  assert.ok(hs[0].request_count >= 1);
  assert.ok(hs[0].multiplier >= 1);
});

test("computeAreaIntelligence end-to-end with empty set", () => {
  const out = computeAreaIntelligence({
    lat: 40.75,
    lng: -73.99,
    radiusMiles: 5,
    driversNearby: 4,
    openRequests: [],
    hour: 15,
    isOnline: true,
  });
  assert.equal(out.requests_nearby, 0);
  assert.equal(out.drivers_nearby, 4);
  assert.equal(out.earnings_multiplier, 1);
  assert.equal(out.best_hotspot, null);
});

test("smart dispatch uses live counts in recommendation", () => {
  const copy = buildSmartDispatchCopy({
    isOnline: true,
    requests: 3,
    drivers: 2,
    multiplier: 1.3,
    best: {
      id: "hs",
      lat: 1,
      lng: 2,
      request_count: 3,
      score: 10,
      multiplier: 1.3,
      demand_level: "busy",
      label: "3 open",
    },
    nearestMiles: 1.2,
  });
  assert.equal(copy.status, "live");
  assert.match(copy.recommendation, /3 open request/);
  assert.match(copy.recommendation, /2 online driver/);
  assert.ok(copy.chips.includes("1.3x earnings"));
});

console.log("driverAreaIntelligence tests passed");
