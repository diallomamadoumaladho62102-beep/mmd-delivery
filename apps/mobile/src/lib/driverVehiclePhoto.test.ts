import assert from "node:assert/strict";
import { vehiclePhotoStoragePath } from "./driverVehiclePhotoPath";

const path = vehiclePhotoStoragePath(
  "8c300089-6f16-407a-9be9-6eb75482f73d",
  "ad9472e9-5f37-4225-a849-271b998ca0a2",
);
assert.equal(
  path,
  "drivers/8c300089-6f16-407a-9be9-6eb75482f73d/vehicles/ad9472e9-5f37-4225-a849-271b998ca0a2/primary.jpg",
);
assert.match(path, /^drivers\/.+\/vehicles\/.+\/primary\.jpg$/);
assert.doesNotMatch(path, /Honda|Toyota|stock/i);

console.log("driverVehiclePhoto.test.ts OK");
