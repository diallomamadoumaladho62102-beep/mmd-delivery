import assert from "node:assert/strict";
import {
  driverInitials,
  readCustomerTrackingIdentification,
  resolveCustomerMediaUrl,
} from "./customerTrackingIdentification";

assert.equal(readCustomerTrackingIdentification(null), null);
assert.equal(
  readCustomerTrackingIdentification({ status: "paid" }),
  null,
);

const id = readCustomerTrackingIdentification({
  driver_id: "d1",
  identification: {
    driver_name: "Ada Lovelace",
    driver_photo: "https://cdn.example/a.jpg",
    driver_rating: 4.9,
    driver_trips_count: 127,
    vehicle_make: "Honda",
    vehicle_model: "Accord Sport",
    vehicle_color: "Gris",
    vehicle_year: 2020,
    vehicle_plate: "LTK 1944",
    vehicle_photo: null,
    vehicle_label: "",
  },
});

assert.ok(id);
assert.equal(id!.driverName, "Ada Lovelace");
assert.equal(id!.driverPhoto, "https://cdn.example/a.jpg");
assert.equal(id!.driverRating, 4.9);
assert.equal(id!.driverTrips, 127);
assert.match(id!.vehicleLabel, /Honda Accord Sport/i);
assert.equal(id!.vehiclePlate, "LTK 1944");
assert.equal(id!.vehiclePhoto, "");
assert.equal(id!.vehicleYear, 2020);
assert.equal(id!.vehicleMake, "Honda");
assert.equal(id!.vehicleModel, "Accord Sport");
assert.equal(id!.vehicleColor, "Gris");
assert.equal(driverInitials("Ada Lovelace"), "AL");

const noRating = readCustomerTrackingIdentification({
  driver_id: "d2",
  driver_name: "New",
  driver_rating: 0,
  driver_trips_count: 0,
});
assert.equal(noRating!.driverRating, null);
assert.equal(noRating!.driverTrips, null);

const prevUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
process.env.EXPO_PUBLIC_SUPABASE_URL = "https://example.supabase.co";

const fromSnapshots = readCustomerTrackingIdentification({
  driver_id: "d3",
  driver_display_name: "Mamadou",
  driver_photo_url: "drivers/u1/avatar.jpg",
  vehicle_make_snapshot: "Honda",
  vehicle_model_snapshot: "Accord Sport",
  vehicle_color_snapshot: "Gris",
  vehicle_year_snapshot: 2020,
  vehicle_plate_snapshot: "LTK 1944",
  vehicle_photo_url_snapshot:
    "drivers/u1/vehicles/v1/primary.jpg",
});
assert.equal(fromSnapshots!.driverName, "Mamadou");
assert.equal(fromSnapshots!.vehiclePlate, "LTK 1944");
assert.equal(fromSnapshots!.vehicleYear, 2020);
assert.match(fromSnapshots!.vehicleLabel, /Honda Accord Sport gris/i);
assert.match(
  fromSnapshots!.vehiclePhoto,
  /\/storage\/v1\/object\/public\/avatars\/drivers\//,
);
assert.match(
  fromSnapshots!.driverPhoto,
  /\/storage\/v1\/object\/public\/avatars\/drivers\//,
);

if (prevUrl === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
else process.env.EXPO_PUBLIC_SUPABASE_URL = prevUrl;

assert.equal(
  resolveCustomerMediaUrl(
    "https://x.supabase.co/storage/v1/object/public/drivers/u/v/primary.jpg",
  ),
  "https://x.supabase.co/storage/v1/object/public/avatars/drivers/u/v/primary.jpg",
);

console.log("customerTrackingIdentification.test.ts OK");
