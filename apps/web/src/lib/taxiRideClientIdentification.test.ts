import assert from "node:assert/strict";
import {
  applyIdentificationToRide,
  formatTaxiVehicleLabel,
  identificationFromLiveSources,
  identificationFromSnapshot,
} from "./taxiRideClientIdentification";

assert.equal(
  formatTaxiVehicleLabel({
    make: "Honda",
    model: "Accord Sport",
    color: "Gris",
  }),
  "Honda Accord Sport gris",
);

assert.equal(
  formatTaxiVehicleLabel({ make: "Honda", model: "Accord Sport" }),
  "Honda Accord Sport",
);

assert.equal(formatTaxiVehicleLabel({}), null);

assert.equal(
  identificationFromSnapshot({ status: "dispatching" }),
  null,
  "no driver_id => no identification",
);

assert.equal(
  identificationFromSnapshot({
    driver_id: "8c300089-6f16-407a-9be9-6eb75482f73d",
  }),
  null,
  "driver without snapshot fields => fall through to live",
);

const snap = identificationFromSnapshot({
  driver_id: "8c300089-6f16-407a-9be9-6eb75482f73d",
  driver_display_name: "Mamadou Maladho Diallo",
  driver_photo_url: "https://example.com/photo.jpg",
  driver_rating_snapshot: 4.8,
  driver_trips_count_snapshot: 20,
  vehicle_make_snapshot: "Honda",
  vehicle_model_snapshot: "Accord Sport",
  vehicle_year_snapshot: 2020,
  vehicle_color_snapshot: "Gris",
  vehicle_plate_snapshot: "LTK 1944",
});

assert.ok(snap);
assert.equal(snap!.vehicle_plate, "LTK 1944");
assert.equal(snap!.vehicle_label, "Honda Accord Sport gris");
assert.equal(snap!.driver_name, "Mamadou Maladho Diallo");
assert.equal(snap!.vehicle_year, 2020);

const bikeBlocked = identificationFromLiveSources({
  driverId: "8c300089-6f16-407a-9be9-6eb75482f73d",
  vehicle: {
    id: "bike-1",
    vehicle_type: "bike",
    vehicle_make: "Trek",
    license_plate: null,
  },
  assignedVehicleId: "bike-1",
});
assert.equal(bikeBlocked, null, "bike vehicle must not surface on taxi ride");

const wrongVehicle = identificationFromLiveSources({
  driverId: "8c300089-6f16-407a-9be9-6eb75482f73d",
  vehicle: {
    id: "other",
    vehicle_type: "sedan",
    vehicle_make: "Toyota",
    license_plate: "OTHER",
  },
  assignedVehicleId: "ad9472e9-5f37-4225-a849-271b998ca0a2",
});
assert.equal(wrongVehicle, null, "must use assigned vehicle only");

const live = identificationFromLiveSources({
  driverId: "8c300089-6f16-407a-9be9-6eb75482f73d",
  profile: { full_name: "Mamadou Maladho Diallo", avatar_url: null },
  driverProfile: {
    photo_url: "https://cdn.example/driver.jpg",
    rating: 4.5,
    total_deliveries: 20,
  },
  vehicle: {
    id: "ad9472e9-5f37-4225-a849-271b998ca0a2",
    vehicle_type: "sedan",
    vehicle_make: "Honda",
    vehicle_model: "Accord Sport",
    vehicle_year: 2020,
    vehicle_color: "Gris",
    license_plate: "LTK 1944",
  },
  assignedVehicleId: "ad9472e9-5f37-4225-a849-271b998ca0a2",
});
assert.ok(live);
assert.equal(live!.vehicle_plate, "LTK 1944");
assert.equal(live!.vehicle_label, "Honda Accord Sport gris");

const beforeAssign = applyIdentificationToRide(
  { id: "ride-1", status: "dispatching", driver_id: null },
  null,
);
assert.equal(beforeAssign.driver_name, null);
assert.equal(beforeAssign.vehicle_plate, null);
assert.equal(beforeAssign.identification, null);
assert.equal("phone" in beforeAssign && beforeAssign.phone != null, false);

const enriched = applyIdentificationToRide(
  {
    id: "ride-2",
    driver_id: "8c300089-6f16-407a-9be9-6eb75482f73d",
    phone: "9297408722",
    vin: "SECRETVIN",
  },
  live,
);
assert.equal(enriched.vehicle_plate, "LTK 1944");
assert.equal(enriched.driver_name, "Mamadou Maladho Diallo");
assert.equal(enriched.phone, undefined);
assert.equal(enriched.vin, undefined);

console.log("taxiRideClientIdentification tests passed");
