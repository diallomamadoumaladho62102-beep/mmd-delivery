import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateRouteDistanceLimit,
  getRouteDistanceLimitMiles,
  isRouteDistanceWithinLimit,
} from "./routeDistanceLimits";
import { evaluateServerRoute } from "./geoTrust";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("defaults: taxi 300 mi, delivery 60 mi", () => {
  assert.equal(getRouteDistanceLimitMiles("taxi"), 300);
  assert.equal(getRouteDistanceLimitMiles("delivery"), 60);
});

test("taxi boundary: 299.99 PASS, 300 PASS, 300.01 BLOCKED", () => {
  assert.equal(isRouteDistanceWithinLimit(299.99, "taxi"), true);
  assert.equal(isRouteDistanceWithinLimit(300, "taxi"), true);
  assert.equal(isRouteDistanceWithinLimit(300.01, "taxi"), false);
  assert.deepEqual(evaluateRouteDistanceLimit(299.99, "taxi"), { ok: true });
  assert.deepEqual(evaluateRouteDistanceLimit(300, "taxi"), { ok: true });
  assert.deepEqual(evaluateRouteDistanceLimit(300.01, "taxi"), {
    ok: false,
    code: "taxi_distance_too_far",
  });
});

test("delivery boundary: 59.99 PASS, 60 PASS, 60.01 BLOCKED", () => {
  assert.equal(isRouteDistanceWithinLimit(59.99, "delivery"), true);
  assert.equal(isRouteDistanceWithinLimit(60, "delivery"), true);
  assert.equal(isRouteDistanceWithinLimit(60.01, "delivery"), false);
  assert.deepEqual(evaluateRouteDistanceLimit(59.99, "delivery"), { ok: true });
  assert.deepEqual(evaluateRouteDistanceLimit(60, "delivery"), { ok: true });
  assert.deepEqual(evaluateRouteDistanceLimit(60.01, "delivery"), {
    ok: false,
    code: "delivery_distance_too_far",
  });
});

test("invalid / absent distance is blocked before finance", () => {
  for (const bad of [NaN, -1, 0, null, undefined, ""]) {
    assert.equal(isRouteDistanceWithinLimit(bad, "taxi"), false);
    assert.equal(isRouteDistanceWithinLimit(bad, "delivery"), false);
    assert.equal(evaluateRouteDistanceLimit(bad, "taxi").ok, false);
    assert.equal(evaluateRouteDistanceLimit(bad, "delivery").ok, false);
  }
});

test("evaluateServerRoute uses service-specific limits", () => {
  const pickup = { lat: 40.7484, lng: -73.9857 };
  const dropoff = { lat: 40.758, lng: -73.9855 };

  assert.equal(
    evaluateServerRoute({
      pickup,
      dropoff,
      serverDistanceMiles: 300,
      service: "taxi",
    }).ok,
    true,
  );
  assert.deepEqual(
    evaluateServerRoute({
      pickup,
      dropoff,
      serverDistanceMiles: 300.01,
      service: "taxi",
    }),
    { ok: false, code: "taxi_distance_too_far" },
  );

  assert.equal(
    evaluateServerRoute({
      pickup,
      dropoff,
      serverDistanceMiles: 60,
      service: "delivery",
    }).ok,
    true,
  );
  assert.deepEqual(
    evaluateServerRoute({
      pickup,
      dropoff,
      serverDistanceMiles: 60.01,
      service: "delivery",
    }),
    { ok: false, code: "delivery_distance_too_far" },
  );
});

test("business defaults + DB migration seed taxi/delivery max distance keys", () => {
  const defaults = readFileSync(
    join(process.cwd(), "src/lib/pricingEngine/config/businessDefaults.ts"),
    "utf8",
  );
  assert.match(defaults, /taxi_max_distance_miles:\s*300/);
  assert.match(defaults, /delivery_max_distance_miles:\s*60/);

  const mig = readFileSync(
    join(process.cwd(), "..", "..", "supabase/migrations/20261125140000_route_distance_limits.sql"),
    "utf8",
  );
  assert.match(mig, /taxi_max_distance_miles',\s*300/);
  assert.match(mig, /delivery_max_distance_miles',\s*60/);
});

test("taxiMapbox uses centralized limit (no hardcoded 50)", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/taxiMapbox.ts"), "utf8");
  assert.doesNotMatch(src, /BLOCK_MILES\s*=\s*50/);
  assert.match(src, /assertRouteDistanceWithinLimit|evaluateRouteDistanceLimit/);
});

console.log("routeDistanceLimits regression passed");
