import assert from "node:assert/strict";
import {
  clientDisplayInitials,
  resolveAvatarPublicUrl,
  resolveClientMeetingPoint,
} from "./driverTaxiClientDisplay";

assert.deepEqual(
  resolveClientMeetingPoint({
    stage: "pickup",
    pickupLat: 40.7128,
    pickupLng: -74.006,
  }),
  { latitude: 40.7128, longitude: -74.006 },
);

assert.equal(
  resolveClientMeetingPoint({
    stage: "pickup",
    pickupLat: 0,
    pickupLng: 0,
  }),
  null,
);

assert.equal(
  resolveClientMeetingPoint({
    stage: "pickup",
    pickupLat: undefined,
    pickupLng: -74,
  }),
  null,
);

assert.equal(
  resolveClientMeetingPoint({
    stage: "dropoff",
    pickupLat: 40.7,
    pickupLng: -74,
  }),
  null,
);

assert.equal(
  resolveClientMeetingPoint({
    stage: "pickup",
    pickupLat: "not-a-number",
    pickupLng: -74,
  }),
  null,
);

assert.equal(clientDisplayInitials("Awa Diallo"), "AD");
assert.equal(clientDisplayInitials(""), "?");
assert.equal(clientDisplayInitials(null), "?");

assert.equal(resolveAvatarPublicUrl(null, "https://proj.supabase.co"), null);
assert.equal(
  resolveAvatarPublicUrl(
    "https://cdn.example/a.jpg",
    "https://proj.supabase.co",
  ),
  "https://cdn.example/a.jpg",
);
assert.equal(
  resolveAvatarPublicUrl("clients/u1/a.jpg", "https://proj.supabase.co"),
  "https://proj.supabase.co/storage/v1/object/public/avatars/clients/u1/a.jpg",
);
assert.equal(resolveAvatarPublicUrl("clients/u1/a.jpg", null), null);

console.log("driverTaxiClientDisplay tests passed");
