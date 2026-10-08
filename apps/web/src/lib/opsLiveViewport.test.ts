import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { filterOpsMissions, isDriverLocationStale, isLiveOpsStatus, type OpsMission } from "./opsLiveCenter";
import {
  OPS_NEUTRAL_VIEWPORT,
  isValidOpsCoordinate,
  shouldAutoFitViewport,
  viewportContains,
  viewportForCoordinates,
} from "./opsLiveViewport";

const nyc = [
  { lng: -73.9857, lat: 40.7484 },
  { lng: -74.006, lat: 40.7128 },
];
const nassau = [
  { lng: -73.64, lat: 40.73 },
  { lng: -73.58, lat: 40.68 },
];

const one = viewportForCoordinates([nyc[0]]);
assert.equal(one.zoom, 14);
assert.ok(Math.abs(one.longitude - nyc[0].lng) < 0.001);
assert.ok(Math.abs(one.latitude - nyc[0].lat) < 0.001);

const nearby = viewportForCoordinates(nyc);
assert.ok(nearby.zoom >= 10 && nearby.zoom < 15);
assert.ok(viewportContains(nearby, nyc[0]));
assert.ok(viewportContains(nearby, nyc[1]));

const newYork = viewportForCoordinates(nyc);
assert.ok(newYork.latitude > 40.55 && newYork.latitude < 40.9);
assert.ok(newYork.longitude < -73.9 && newYork.longitude > -74.1);
assert.ok(newYork.zoom >= 10);

const nassauView = viewportForCoordinates(nassau);
assert.ok(nassauView.latitude > 40.58 && nassauView.latitude < 40.92);
assert.ok(nassauView.longitude > -73.77 && nassauView.longitude < -73.42);
assert.ok(nassauView.zoom >= 10);

const cities = viewportForCoordinates([...nyc, ...nassau]);
for (const point of [...nyc, ...nassau]) {
  assert.ok(viewportContains(cities, point), `${point.lng},${point.lat} inside fitted cities`);
}
assert.ok(cities.zoom >= 8);
assert.ok(cities.zoom < 14);

const empty = viewportForCoordinates([]);
assert.equal(empty.zoom, OPS_NEUTRAL_VIEWPORT.zoom);
assert.ok(empty.zoom >= 10);
assert.ok(empty.latitude > 40.5 && empty.latitude < 41);
assert.ok(empty.longitude > -74.2 && empty.longitude < -73.2);

assert.equal(isValidOpsCoordinate(0, 0), false);
assert.equal(isValidOpsCoordinate(Number.NaN, 40), false);
assert.equal(isValidOpsCoordinate(200, 40), false);
const cleaned = viewportForCoordinates([...nyc, { lng: 0, lat: 0 }, { lng: 400, lat: 10 }]);
assert.ok(viewportContains(cleaned, nyc[0]));
assert.ok(viewportContains(cleaned, nyc[1]));
assert.equal(viewportContains(cleaned, { lng: 0, lat: 0 }), false);
assert.ok(cleaned.zoom >= 10);

const now = Date.parse("2026-10-07T18:00:00.000Z");
assert.equal(isDriverLocationStale("2026-10-07T17:30:00.000Z", now), true);
assert.equal(isDriverLocationStale("2026-10-07T17:59:00.000Z", now), false);
const staleFramed = viewportForCoordinates([{ lng: -73.6, lat: 40.72 }]);
assert.equal(staleFramed.zoom, 14);

assert.equal(shouldAutoFitViewport({ userAdjusted: true, reason: "refresh" }), false);
assert.equal(shouldAutoFitViewport({ userAdjusted: false, reason: "refresh" }), false);
assert.equal(shouldAutoFitViewport({ userAdjusted: true, reason: "load" }), false);
assert.equal(shouldAutoFitViewport({ userAdjusted: false, reason: "load" }), true);
assert.equal(shouldAutoFitViewport({ userAdjusted: true, reason: "manual-fit" }), true);
assert.equal(shouldAutoFitViewport({ userAdjusted: true, reason: "filter" }), true);
assert.equal(shouldAutoFitViewport({ userAdjusted: true, reason: "select" }), true);

function mission(partial: Partial<OpsMission> & Pick<OpsMission, "id" | "service" | "status" | "lat" | "lng">): OpsMission {
  return {
    phase: "en_route",
    href: "/admin/orders/1",
    driverId: "driver-1",
    clientId: "client-1",
    partnerLabel: null,
    pickupLabel: null,
    dropoffLabel: null,
    etaMinutes: null,
    locationUpdatedAt: null,
    locationStale: false,
    delayed: false,
    attention: null,
    timeline: [],
    updatedAt: null,
    ...partial,
  };
}

const fleet = [
  mission({ id: "taxi-1", service: "taxi", status: "in_progress", lat: nyc[0].lat, lng: nyc[0].lng }),
  mission({ id: "food-1", service: "food", status: "accepted", lat: nassau[0].lat, lng: nassau[0].lng }),
  mission({ id: "del-1", service: "delivery", status: "picked_up", lat: nassau[1].lat, lng: nassau[1].lng }),
  mission({ id: "mkt-1", service: "marketplace", status: "ready", lat: nyc[1].lat, lng: nyc[1].lng }),
  mission({ id: "done-1", service: "food", status: "completed", lat: 25, lng: -80 }),
  mission({ id: "cancel-1", service: "taxi", status: "cancelled", lat: 34, lng: -118 }),
];

const live = fleet.filter((item) => isLiveOpsStatus(item.status));
assert.equal(live.some((item) => item.id === "done-1"), false);
assert.equal(live.some((item) => item.id === "cancel-1"), false);

function viewFor(service: OpsMission["service"] | "all") {
  const rows = filterOpsMissions(live, { service });
  return viewportForCoordinates(rows.map((row) => ({ lng: row.lng ?? Number.NaN, lat: row.lat ?? Number.NaN })));
}

const searched = filterOpsMissions(live, { q: "food-1" });
assert.equal(searched.length, 1);
const searchedView = viewportForCoordinates(searched.map((row) => ({ lng: row.lng!, lat: row.lat! })));
assert.equal(searchedView.zoom, 14);
assert.ok(Math.abs(searchedView.latitude - nassau[0].lat) < 0.001);

const taxiView = viewFor("taxi");
assert.equal(taxiView.zoom, 14);
assert.ok(Math.abs(taxiView.longitude - nyc[0].lng) < 0.001);

const foodView = viewFor("food");
assert.equal(foodView.zoom, 14);
assert.ok(Math.abs(foodView.longitude - nassau[0].lng) < 0.001);

const deliveryView = viewFor("delivery");
assert.equal(deliveryView.zoom, 14);
assert.ok(viewportContains(deliveryView, nassau[1]));

const marketView = viewFor("marketplace");
assert.equal(marketView.zoom, 14);
assert.ok(viewportContains(marketView, nyc[1]));

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const restaurant = fs.readFileSync(path.join(root, "apps/web/src/lib/restaurantCommandCenter.ts"), "utf8");
assert.match(restaurant, /distanceMeters: null/);
assert.doesNotMatch(restaurant, /lat: asNumber\(driverLocationMap/);

console.log("opsLiveViewport.test.ts OK");
