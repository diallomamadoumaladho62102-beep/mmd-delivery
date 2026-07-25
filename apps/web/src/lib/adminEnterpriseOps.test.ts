import assert from "node:assert/strict";
import { filterOpsFeatures, pointFeature } from "./adminOpsMap";
import { getStaffCallProviderPlan } from "./staffCallsProvider";
import { resolveCcCapability } from "./adminFeatureFlags";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("ops map pointFeature validates coordinates", () => {
  assert.equal(
    pointFeature(200, 10, {
      id: "1",
      layer: "drivers_online",
      label: "x",
      href: "/admin",
    }),
    null
  );
  const f = pointFeature(-73.9, 40.7, {
    id: "1",
    layer: "drivers_online",
    label: "Driver",
    href: "/admin/drivers",
  });
  assert.ok(f);
  assert.equal(f!.geometry.coordinates[0], -73.9);
});

test("ops map filters by layer country and query", () => {
  const features = [
    pointFeature(-73.9, 40.7, {
      id: "1",
      layer: "drivers_online",
      label: "Alice",
      href: "/a",
      country_code: "US",
      city: "New York",
    })!,
    pointFeature(-0.1, 51.5, {
      id: "2",
      layer: "orders_pending",
      label: "Order",
      href: "/b",
      country_code: "GB",
      city: "London",
    })!,
  ];
  const filtered = filterOpsFeatures(features, {
    layers: ["drivers_online"],
    country: "US",
    q: "ali",
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].properties.id, "1");
});

test("call provider is fail-closed without credentials", () => {
  const plan = getStaffCallProviderPlan();
  // In CI without Twilio secrets, live rooms must not be creatable.
  if (!process.env.TWILIO_API_KEY_SID) {
    assert.equal(plan.canCreateLiveRoom, false);
  }
});

test("map capability reflects public mapbox token", () => {
  const status = resolveCcCapability("liveMapboxOpsMap");
  assert.equal(typeof status.enabled, "boolean");
  assert.equal(status.provider, "mapbox");
});

console.log("adminEnterpriseOps tests passed");
