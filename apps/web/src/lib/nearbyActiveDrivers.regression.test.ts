import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NEARBY_MAX_RADIUS_MILES,
  NEARBY_MAX_RESULTS,
  anonymousMarkerId,
  clampNearbyRadiusMiles,
  normalizeNearbyCategory,
  obfuscateDriverPoint,
  passesLocalNearbyRules,
  resolvePrebookingEta,
  toPublicNearbyDriver,
} from "./nearbyActiveDrivers";
import {
  createNearbyReaders,
  loadNearbyActiveDrivers,
  type NearbyReaders,
} from "./nearbyActiveDriversService";

const root = path.dirname(fileURLToPath(import.meta.url));
const routeSrc = fs.readFileSync(
  path.join(root, "../../app/api/taxi/nearby-drivers/route.ts"),
  "utf8",
);
const serviceSrc = fs.readFileSync(path.join(root, "nearbyActiveDriversService.ts"), "utf8");
const pureSrc = fs.readFileSync(path.join(root, "nearbyActiveDrivers.ts"), "utf8");

const NOW = new Date("2026-10-07T16:00:00.000Z");
const FRESH = "2026-10-07T15:50:00.000Z";
const STALE = "2026-10-07T15:30:00.000Z";
const PICKUP = { lat: 40.75, lng: -73.99 };
const DRIVER_A = "11111111-1111-4111-8111-111111111111";
const DRIVER_B = "22222222-2222-4222-8222-222222222222";

function profile(overrides: Record<string, unknown> = {}) {
  return {
    user_id: DRIVER_A,
    is_online: true,
    status: "approved",
    account_status: "active",
    is_test: false,
    archived: false,
    ...overrides,
  };
}

function location(overrides: Record<string, unknown> = {}) {
  return {
    driver_id: DRIVER_A,
    lat: 40.751,
    lng: -73.991,
    updated_at: FRESH,
    ...overrides,
  };
}

function readers(overrides: Partial<NearbyReaders> = {}): NearbyReaders & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async readLocations() {
      calls.push("locations");
      return [location()];
    },
    async readProfiles() {
      calls.push("profiles");
      return [profile()];
    },
    async categoryEligible(id, category) {
      calls.push(`eligible:${id}:${category}`);
      return true;
    },
    async canReceiveOffer(id) {
      calls.push(`offer:${id}`);
      return true;
    },
    ...overrides,
  };
}

async function load(
  partial: Partial<Parameters<typeof loadNearbyActiveDrivers>[0]> = {},
  routeMinutes?: Parameters<typeof loadNearbyActiveDrivers>[0]["routeMinutes"],
) {
  const bag = (partial.readers as ReturnType<typeof readers> | undefined) ?? readers();
  const routes: Array<{ lat: number; lng: number }> = [];
  const result = await loadNearbyActiveDrivers({
    pickupLat: PICKUP.lat,
    pickupLng: PICKUP.lng,
    vehicleClass: "standard",
    now: NOW,
    routeMinutes: routeMinutes ?? (async (from) => {
      routes.push(from);
      return 6;
    }),
    ...partial,
    readers: bag,
  });
  return { result, routes, calls: (partial.readers as { calls?: string[] } | undefined)?.calls ?? bag.calls };
}

const authIndex = routeSrc.indexOf("await requireTaxiApiUser");
const loadIndex = routeSrc.indexOf("await loadNearbyActiveDrivers");
assert.ok(authIndex >= 0 && authIndex < loadIndex, "authentication runs before the nearby read");
assert.match(routeSrc, /checkRateLimit/);
assert.match(routeSrc, /limit:\s*20/);
assert.doesNotMatch(routeSrc, /taxi_rides|createTaxiOffers|runTaxiRideDispatch|PaymentIntent|stripe/i);
assert.doesNotMatch(serviceSrc, /\.insert\(|\.update\(|\.delete\(|createTaxiOffers|PaymentIntent|stripe/i);
assert.doesNotMatch(pureSrc, /haversine_miles \* 2\.5|minutesFromMiles|straightLineMinutes/);
assert.match(serviceSrc, /is_taxi_driver_eligible/);
assert.match(serviceSrc, /taxi_driver_can_receive_offer/);
assert.match(serviceSrc, /select\("driver_id,lat,lng,updated_at"\)/);
assert.doesNotMatch(serviceSrc, /phone|email|full_name|home_address/i);

assert.equal(normalizeNearbyCategory("premium"), "comfort");
assert.equal(normalizeNearbyCategory("comfort"), "comfort");
assert.equal(normalizeNearbyCategory("wheelchair"), "wheelchair_accessible");
assert.equal(normalizeNearbyCategory("wheelchair_accessible"), "wheelchair_accessible");
assert.equal(normalizeNearbyCategory("XL"), "xl");
assert.equal(normalizeNearbyCategory("standard"), "standard");
assert.equal(normalizeNearbyCategory("suv"), null);

assert.equal(clampNearbyRadiusMiles(500), NEARBY_MAX_RADIUS_MILES);
assert.equal(clampNearbyRadiusMiles(-4), 0.25);
assert.equal(clampNearbyRadiusMiles("nope"), 5);

const exact = obfuscateDriverPoint(40.75, -73.99);
assert.notEqual(exact.latitude, 40.75);
assert.notEqual(exact.longitude, -73.99);
const onGrid = obfuscateDriverPoint(40, -74);
assert.notEqual(onGrid.latitude, 40);
assert.notEqual(onGrid.longitude, -74);

const marker = anonymousMarkerId(DRIVER_A);
assert.notEqual(marker, DRIVER_A);
assert.equal(marker.includes(DRIVER_A), false);
assert.equal(anonymousMarkerId(DRIVER_A), marker);

const localBase = {
  profile: profile(),
  updatedAt: FRESH,
  miles: 0.2,
  radiusMiles: 5,
  now: NOW,
};
assert.equal(passesLocalNearbyRules(localBase), true);
assert.equal(passesLocalNearbyRules({ ...localBase, profile: profile({ status: "pending" }) }), false);
assert.equal(passesLocalNearbyRules({ ...localBase, profile: profile({ status: "suspended" }) }), false);
assert.equal(passesLocalNearbyRules({ ...localBase, profile: profile({ status: "disabled" }) }), false);
assert.equal(passesLocalNearbyRules({ ...localBase, profile: profile({ status: "archived" }) }), false);
assert.equal(passesLocalNearbyRules({ ...localBase, profile: profile({ status: "test" }) }), false);
assert.equal(passesLocalNearbyRules({ ...localBase, profile: profile({ is_test: true }) }), false);
assert.equal(passesLocalNearbyRules({ ...localBase, profile: profile({ archived: true }) }), false);
assert.equal(passesLocalNearbyRules({ ...localBase, profile: profile({ account_status: "suspended" }) }), false);
assert.equal(passesLocalNearbyRules({ ...localBase, profile: profile({ account_status: "disabled" }) }), false);
assert.equal(passesLocalNearbyRules({ ...localBase, profile: profile({ is_online: false }) }), false);
assert.equal(passesLocalNearbyRules({ ...localBase, updatedAt: STALE }), false);
assert.equal(passesLocalNearbyRules({ ...localBase, miles: 9, radiusMiles: 8 }), false);
assert.equal(passesLocalNearbyRules({ ...localBase, profile: undefined }), false);

const unauthenticated = routeSrc.slice(authIndex, loadIndex);
assert.match(unauthenticated, /auth\.ok === false/);
assert.match(unauthenticated, /return auth\.response/);

async function main() {
const approved = await load();
assert.equal(approved.result.ok, true);
if (approved.result.ok) {
  assert.equal(approved.result.informational, true);
  assert.equal(approved.result.drivers.length, 1);
  const driver = approved.result.drivers[0];
  assert.deepEqual(Object.keys(driver).sort(), ["latitude", "longitude", "marker_id"]);
  assert.equal(JSON.stringify(approved.result).includes(DRIVER_A), false);
  assert.notEqual(driver.latitude, 40.751);
  assert.notEqual(driver.longitude, -73.991);
  assert.equal(approved.result.eta.available, true);
  assert.equal(approved.result.eta.minutes, 6);
  assert.equal(approved.routes.length, 1);
  assert.equal(approved.routes[0].lat, 40.751);
}
assert.equal(approved.calls.some((call) => call.startsWith("eligible:")), true);

const rejected = await load({
  readers: readers({
    async categoryEligible() {
      return false;
    },
  }),
});
assert.equal(rejected.result.ok, true);
if (rejected.result.ok) {
  assert.equal(rejected.result.drivers.length, 0);
  assert.equal(rejected.result.eta.available, false);
  assert.equal(rejected.result.eta.minutes, null);
}
assert.equal(rejected.routes.length, 0);

const onTrip = await load({
  readers: readers({
    async canReceiveOffer() {
      return false;
    },
  }),
});
if (onTrip.result.ok) assert.equal(onTrip.result.drivers.length, 0);

const far = await load({
  radiusMiles: 500,
  readers: readers({
    async readLocations() {
      return [location({ lat: 40.9, lng: -73.99 })];
    },
  }),
});
if (far.result.ok) {
  assert.equal(far.result.radius_miles, NEARBY_MAX_RADIUS_MILES);
  assert.equal(far.result.drivers.length, 0);
}

const manyIds = Array.from({ length: 12 }, (_, index) =>
  `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
);
let eligibilityChecks = 0;
const capped = await load({
  readers: readers({
    async readLocations() {
      return manyIds.map((id, index) =>
        location({ driver_id: id, lat: 40.751 + index * 0.001, lng: -73.991 }),
      );
    },
    async readProfiles() {
      return manyIds.map((id) => profile({ user_id: id }));
    },
    async categoryEligible() {
      eligibilityChecks += 1;
      return true;
    },
    async canReceiveOffer() {
      return true;
    },
  }),
});
if (capped.result.ok) assert.equal(capped.result.drivers.length, NEARBY_MAX_RESULTS);
assert.equal(eligibilityChecks, NEARBY_MAX_RESULTS);

const etaDown = await load({}, async () => {
  throw new Error("mapbox_down");
});
if (etaDown.result.ok) {
  assert.equal(etaDown.result.drivers.length, 1);
  assert.equal(etaDown.result.eta.available, false);
  assert.equal(etaDown.result.eta.minutes, null);
}

const etaAbsurd = await resolvePrebookingEta(
  { lat: 40.751, lng: -73.991 },
  PICKUP,
  async () => 9999,
);
assert.deepEqual(etaAbsurd, { available: false, minutes: null });

const alias = await load({ vehicleClass: "premium" });
if (alias.result.ok) assert.equal(alias.result.category, "comfort");
const wheelchair = await load({ vehicleClass: "wheelchair" });
if (wheelchair.result.ok) assert.equal(wheelchair.result.category, "wheelchair_accessible");

const badPickup = await load({ pickupLat: 0, pickupLng: 0 });
assert.deepEqual(badPickup.result, { ok: false, error: "invalid_pickup" });
const badCategory = await load({ vehicleClass: "limo" });
assert.deepEqual(badCategory.result, { ok: false, error: "invalid_category" });

const publicDriver = toPublicNearbyDriver(DRIVER_B, 40.752, -73.992);
assert.equal(JSON.stringify(publicDriver).includes(DRIVER_B), false);
assert.equal("user_id" in publicDriver, false);
assert.equal("updated_at" in publicDriver, false);

const writes: string[] = [];
const admin = {
  from(table: string) {
    return {
      select(columns: string) {
        writes.push(`${table}:${columns}`);
        return this;
      },
      gte() {
        return this;
      },
      lte() {
        return this;
      },
      in() {
        return Promise.resolve({ data: [], error: null });
      },
      limit() {
        return Promise.resolve({ data: [], error: null });
      },
      insert() {
        writes.push("insert");
        return Promise.resolve({ error: null });
      },
      update() {
        writes.push("update");
        return Promise.resolve({ error: null });
      },
      delete() {
        writes.push("delete");
        return Promise.resolve({ error: null });
      },
    };
  },
};
const userClient = {
  rpc(name: string) {
    writes.push(`rpc:${name}`);
    return Promise.resolve({ data: false, error: null });
  },
};
const liveReaders = createNearbyReaders(admin as never, userClient as never);
await liveReaders.readLocations({
  minLat: 0,
  maxLat: 1,
  minLng: 0,
  maxLng: 1,
  freshSince: FRESH,
  limit: 60,
});
await liveReaders.readProfiles([DRIVER_A]);
assert.equal(await liveReaders.categoryEligible(DRIVER_A, "standard"), false);
assert.equal(await liveReaders.canReceiveOffer(DRIVER_A), false);
assert.deepEqual(writes.filter((item) => item === "insert" || item === "update" || item === "delete"), []);
assert.ok(writes.includes("driver_locations:driver_id,lat,lng,updated_at"));
assert.ok(writes.includes("driver_profiles:user_id,is_online,status"));
assert.ok(writes.includes("profiles:id,account_status"));
assert.equal(writes.some((item) => /phone|email|name/i.test(item)), false);

console.log("nearbyActiveDrivers.regression.test.ts OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
