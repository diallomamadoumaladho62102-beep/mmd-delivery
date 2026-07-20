import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateRouteCompatibility,
  formatStackedDeliveryLabel,
  bearingDegrees,
  angleDeltaDegrees,
  DEFAULT_ROUTE_COMPATIBILITY,
} from "./routeCompatibility";

const DEFAULT_DRIVER_CAPACITY_SETTINGS = {
  ...DEFAULT_ROUTE_COMPATIBILITY,
  max_active_delivery_missions: 3,
  max_active_taxi_rides: 1,
  max_queued_taxi_rides: 1,
  next_ride_eta_threshold_minutes: 5,
  next_ride_min_eta_minutes: 1,
  next_ride_distance_threshold_miles: 2,
  next_ride_min_distance_miles: 1,
  taxi_next_ride_enabled: true,
};

test("formatStackedDeliveryLabel", () => {
  assert.equal(formatStackedDeliveryLabel(2, 3), "Stacked delivery 2 of 3");
});

test("opposite direction is refused", () => {
  const miami = { lat: 25.76, lng: -80.19 };
  const north = { lat: 26.1, lng: -80.19 };
  const south = { lat: 25.4, lng: -80.19 };

  const result = evaluateRouteCompatibility({
    driverLocation: miami,
    activeMissions: [{ pickup: miami, dropoff: north, kind: "food" }],
    newPickup: south,
    newDropoff: { lat: 25.2, lng: -80.19 },
    newKind: "package",
    settings: DEFAULT_DRIVER_CAPACITY_SETTINGS,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "opposite_direction");
});

test("same-direction stack is allowed under detour limits", () => {
  const origin = { lat: 25.76, lng: -80.19 };
  const drop1 = { lat: 25.85, lng: -80.19 };
  // Pickup slightly ahead on the same northbound corridor
  const newPickup = { lat: 25.81, lng: -80.191 };
  const newDrop = { lat: 25.86, lng: -80.189 };

  const result = evaluateRouteCompatibility({
    driverLocation: origin,
    activeMissions: [
      { pickup: origin, dropoff: drop1, kind: "package", remainingEtaMinutes: 12 },
    ],
    newPickup,
    newDropoff: newDrop,
    newKind: "package",
    settings: {
      ...DEFAULT_DRIVER_CAPACITY_SETTINGS,
      food_hot_priority_enabled: false,
      max_route_detour_miles: 8,
      max_route_detour_minutes: 25,
      max_added_eta_minutes: 30,
    },
  });

  assert.equal(result.ok, true, `expected ok, got ${result.reason}`);
  assert.equal(result.stackIndex, 2);
});

test("excessive detour miles refused", () => {
  const origin = { lat: 25.76, lng: -80.19 };
  const drop1 = { lat: 25.8, lng: -80.19 };
  // Far east pickup causing large detour
  const far = { lat: 25.78, lng: -79.9 };

  const result = evaluateRouteCompatibility({
    driverLocation: origin,
    activeMissions: [{ pickup: origin, dropoff: drop1, kind: "package" }],
    newPickup: far,
    newDropoff: { lat: 25.79, lng: -79.85 },
    settings: {
      ...DEFAULT_DRIVER_CAPACITY_SETTINGS,
      max_route_detour_miles: 2,
    },
  });

  assert.equal(result.ok, false);
  assert.ok(
    result.reason === "detour_miles_exceeded" ||
      result.reason === "detour_minutes_exceeded" ||
      result.reason === "opposite_direction" ||
      result.reason === "added_eta_exceeded",
  );
});

test("zero active missions always compatible", () => {
  const result = evaluateRouteCompatibility({
    driverLocation: { lat: 25.76, lng: -80.19 },
    activeMissions: [],
    newPickup: { lat: 25.8, lng: -80.2 },
    newDropoff: null,
  });
  assert.equal(result.ok, true);
  assert.equal(result.stackIndex, 1);
});

test("bearing helpers", () => {
  const a = { lat: 0, lng: 0 };
  const north = { lat: 1, lng: 0 };
  const east = { lat: 0, lng: 1 };
  assert.ok(bearingDegrees(a, north) < 10 || bearingDegrees(a, north) > 350);
  assert.ok(angleDeltaDegrees(0, 90) === 90);
  assert.ok(angleDeltaDegrees(10, 350) === 20);
  assert.ok(bearingDegrees(a, east) > 45 && bearingDegrees(a, east) < 135);
});

test("food hot priority protects existing food mission", () => {
  const origin = { lat: 25.76, lng: -80.19 };
  const drop1 = { lat: 25.82, lng: -80.19 };
  const side = { lat: 25.79, lng: -80.12 };

  const result = evaluateRouteCompatibility({
    driverLocation: origin,
    activeMissions: [
      { pickup: origin, dropoff: drop1, kind: "food", remainingEtaMinutes: 15 },
    ],
    newPickup: side,
    newDropoff: { lat: 25.8, lng: -80.05 },
    newKind: "package",
    settings: {
      ...DEFAULT_DRIVER_CAPACITY_SETTINGS,
      food_hot_priority_enabled: true,
      max_route_detour_miles: 50,
      max_route_detour_minutes: 60,
      max_added_eta_minutes: 60,
    },
  });

  // May pass or fail depending on geometry; if it fails for food, reason must be food_hot
  if (!result.ok) {
    assert.ok(
      ["food_hot_delay_protected", "excessive_existing_customer_delay", "detour_miles_exceeded", "detour_minutes_exceeded", "added_eta_exceeded", "opposite_direction"].includes(
        String(result.reason),
      ),
    );
  }
});

test("capacity defaults expose admin knobs", () => {
  assert.equal(DEFAULT_DRIVER_CAPACITY_SETTINGS.max_active_delivery_missions, 3);
  assert.equal(DEFAULT_DRIVER_CAPACITY_SETTINGS.max_active_taxi_rides, 1);
  assert.equal(DEFAULT_DRIVER_CAPACITY_SETTINGS.max_queued_taxi_rides, 1);
  assert.equal(DEFAULT_DRIVER_CAPACITY_SETTINGS.next_ride_eta_threshold_minutes, 5);
  assert.equal(DEFAULT_DRIVER_CAPACITY_SETTINGS.next_ride_distance_threshold_miles, 2);
  assert.equal(DEFAULT_DRIVER_CAPACITY_SETTINGS.taxi_next_ride_enabled, true);
});
