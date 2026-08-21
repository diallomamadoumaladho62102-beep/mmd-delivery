import assert from "node:assert/strict";
import {
  buildTaxiDriverClientDisplay,
  resolveTaxiClientMeetingPoint,
} from "./taxiDriverClientDisplay";

const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";

const assigned = buildTaxiDriverClientDisplay({
  rideStatus: "accepted",
  driverId: "driver-1",
  viewerDriverId: "driver-1",
  clientUserId: "client-1",
  profile: {
    full_name: "Awa Diallo",
    avatar_url: "clients/client-1/avatar.jpg",
  },
});
assert.ok(assigned);
assert.equal(assigned!.full_name, "Awa Diallo");
assert.match(String(assigned!.avatar_url), /avatars\/clients\/client-1\/avatar\.jpg/);

assert.equal(
  buildTaxiDriverClientDisplay({
    rideStatus: "accepted",
    driverId: "driver-1",
    viewerDriverId: "other-driver",
    clientUserId: "client-1",
    profile: { full_name: "Awa", avatar_url: null },
  }),
  null,
  "other driver must not receive client display",
);

assert.equal(
  buildTaxiDriverClientDisplay({
    rideStatus: "completed",
    driverId: "driver-1",
    viewerDriverId: "driver-1",
    clientUserId: "client-1",
    profile: { full_name: "Awa", avatar_url: null },
  }),
  null,
  "completed ride must not expose live client display",
);

assert.equal(
  buildTaxiDriverClientDisplay({
    rideStatus: "canceled",
    driverId: "driver-1",
    viewerDriverId: "driver-1",
    clientUserId: "client-1",
    profile: { full_name: "Awa", avatar_url: null },
  }),
  null,
  "canceled ride must not expose client display",
);

const fallback = buildTaxiDriverClientDisplay({
  rideStatus: "driver_arrived",
  driverId: "driver-1",
  viewerDriverId: "driver-1",
  clientUserId: "client-1",
  profile: { full_name: null, avatar_url: null },
});
assert.ok(fallback);
assert.equal(fallback!.full_name, null);
assert.equal(fallback!.avatar_url, null);

assert.deepEqual(
  resolveTaxiClientMeetingPoint({
    stage: "pickup",
    pickupLat: 40.7,
    pickupLng: -73.9,
  }),
  { latitude: 40.7, longitude: -73.9 },
);

assert.equal(
  resolveTaxiClientMeetingPoint({
    stage: "dropoff",
    pickupLat: 40.7,
    pickupLng: -73.9,
  }),
  null,
  "no client meeting pin on dropoff stage",
);

assert.equal(
  resolveTaxiClientMeetingPoint({
    stage: "pickup",
    pickupLat: 0,
    pickupLng: 0,
  }),
  null,
  "reject 0,0",
);

assert.equal(
  resolveTaxiClientMeetingPoint({
    stage: "pickup",
    pickupLat: null,
    pickupLng: -73.9,
  }),
  null,
  "reject missing lat",
);

assert.equal(
  resolveTaxiClientMeetingPoint({
    stage: "pickup",
    pickupLat: 91,
    pickupLng: -73.9,
  }),
  null,
  "reject out-of-range lat",
);

process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
console.log("taxiDriverClientDisplay tests passed");
