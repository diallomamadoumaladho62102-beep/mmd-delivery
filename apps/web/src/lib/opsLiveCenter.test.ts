import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildOpsLiveCenter,
  decorateOpsMission,
  filterOpsMissions,
  isLiveOpsStatus,
  opsServiceFromKind,
  trustedRouteEtaMinutes,
} from "./opsLiveCenter";

const now = Date.parse("2026-10-07T18:00:00.000Z");

function mission(partial: Parameters<typeof decorateOpsMission>[0]) {
  return decorateOpsMission({ nowMs: now, ...partial });
}

const base = {
  href: "/admin/orders/1",
  driverId: "driver-1",
  clientId: "client-1",
  partnerLabel: "Kitchen",
  pickupLabel: "12 Main",
  dropoffLabel: "JFK",
  etaMinutes: 7,
  etaSource: "mapbox" as const,
  locationUpdatedAt: "2026-10-07T17:59:40.000Z",
  driverAssigned: true,
  lat: 40.7,
  lng: -74,
  timeline: [{ key: "assigned", label: "Driver assigned", at: "2026-10-07T17:50:00.000Z", done: true }],
  updatedAt: "2026-10-07T17:50:00.000Z",
  nowMs: now,
};

assert.equal(opsServiceFromKind("food"), "food");
assert.equal(opsServiceFromKind("package"), "delivery");
assert.equal(opsServiceFromKind("marketplace"), "marketplace");
assert.equal(opsServiceFromKind("unknown"), null);
assert.equal(isLiveOpsStatus("completed"), false);
assert.equal(isLiveOpsStatus("cancelled"), false);
assert.equal(isLiveOpsStatus("accepted"), true);
assert.equal(trustedRouteEtaMinutes("straight", 9), null);
assert.equal(trustedRouteEtaMinutes("mapbox", 9), 9);
assert.equal(trustedRouteEtaMinutes("cache", 4), 4);

const live = mission({ ...base, id: "food-1", service: "food", status: "en_route" });
const stale = mission({
  ...base,
  id: "taxi-1",
  service: "taxi",
  status: "accepted",
  locationUpdatedAt: "2026-10-07T16:00:00.000Z",
});
const done = mission({ ...base, id: "old", service: "delivery", status: "delivered" });
assert.equal(live.etaMinutes, 7);
assert.equal(live.locationStale, false);
assert.equal(stale.locationStale, true);
assert.equal(stale.attention, "location_stale");
assert.equal(mission({ ...base, id: "x", service: "food", status: "en_route", etaSource: "straight" }).etaMinutes, null);

const center = buildOpsLiveCenter({
  missions: [live, stale, done],
  safety: [],
  nowMs: now,
});
assert.equal(center.missions.length, 2);
assert.equal(center.metrics.food, 1);
assert.equal(center.metrics.taxi, 1);
assert.equal(center.metrics.delivery, 0);
assert.equal(center.metrics.marketplace, 0);
assert.equal(center.metrics.total, 2);
assert.equal(center.metrics.attention >= 1, true);
assert.equal(center.activity[0]?.label, "Driver assigned");

const filtered = filterOpsMissions(center.missions, { service: "taxi", q: "taxi-1" });
assert.equal(filtered.length, 1);
assert.equal(filterOpsMissions(center.missions, { q: "missing-id" }).length, 0);

const empty = buildOpsLiveCenter({ missions: [], safety: [] });
assert.deepEqual(
  [empty.metrics.taxi, empty.metrics.food, empty.metrics.delivery, empty.metrics.marketplace, empty.metrics.total],
  [0, 0, 0, 0, 0],
);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const route = fs.readFileSync(path.join(root, "apps/web/app/api/admin/ops-map/route.ts"), "utf8");
const authAt = route.indexOf("await assertStaffPermission(\"supervision.read\"");
const adminAt = route.indexOf("buildSupabaseAdminClient(");
assert.ok(authAt > 0 && authAt < adminAt, "ops map authorizes before reading data");
assert.ok(route.includes('route.properties.route_source === "straight"'));
assert.match(route, /delivery_requests/);
assert.doesNotMatch(route, /phone|email/);

const restaurant = fs.readFileSync(path.join(root, "apps/web/src/lib/restaurantCommandCenter.ts"), "utf8");
assert.match(restaurant, /distanceMeters: null/);
assert.doesNotMatch(restaurant, /lat: asNumber\(driverLocationMap/);

console.log("opsLiveCenter.test.ts OK");
