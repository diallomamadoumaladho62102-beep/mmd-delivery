import assert from "node:assert/strict";
import {
  computeDriverSetupProgress,
  isPayoutSetupOk,
  isVehicleSetupOk,
  nextDriverSetupStep,
  normalizeDriverDocType,
} from "./driverSetupProgress";

assert.equal(isVehicleSetupOk({ transport_mode: "bike", active_vehicle_id: null }), true);
assert.equal(isVehicleSetupOk({ transport_mode: "car", active_vehicle_id: null }), false);
assert.equal(
  isVehicleSetupOk({ transport_mode: "car", active_vehicle_id: "veh-1" }),
  true,
);

assert.equal(isPayoutSetupOk({ stripe_onboarded: true }), true);
assert.equal(isPayoutSetupOk({ stripe_onboarded: false }), false);
assert.equal(isPayoutSetupOk({ stripe_onboarded: null }), false);

assert.equal(normalizeDriverDocType("driver_license"), "license_front");

const incomplete = computeDriverSetupProgress({
  profile: {
    transport_mode: "car",
    active_vehicle_id: null,
    stripe_onboarded: false,
  },
  docs: [],
});
assert.equal(incomplete.progress, 0);
assert.equal(nextDriverSetupStep(incomplete), "addVehicle");

const payoutOnlyMissing = computeDriverSetupProgress({
  profile: {
    transport_mode: "bike",
    active_vehicle_id: null,
    stripe_onboarded: false,
  },
  docs: [],
});
assert.equal(payoutOnlyMissing.vehicleOk, true);
assert.equal(payoutOnlyMissing.docsDone, 0);
assert.equal(payoutOnlyMissing.docsTotal, 3);
assert.equal(payoutOnlyMissing.progress, 25);
assert.equal(nextDriverSetupStep(payoutOnlyMissing), "addDocs");

const bikeIdentityDone = computeDriverSetupProgress({
  profile: {
    transport_mode: "bike",
    active_vehicle_id: null,
    stripe_onboarded: false,
  },
  docs: [
    { doc_type: "profile_photo", status: "pending" },
    { doc_type: "id_card_front", status: "pending" },
    { doc_type: "id_card_back", status: "rejected" },
  ],
});
assert.equal(bikeIdentityDone.docsDone, 2);
assert.equal(bikeIdentityDone.docsTotal, 3);
assert.equal(nextDriverSetupStep(bikeIdentityDone), "addDocs");

const ready = computeDriverSetupProgress({
  profile: {
    transport_mode: "moto",
    active_vehicle_id: "abc",
    stripe_onboarded: true,
  },
  docs: [
    { doc_type: "profile_photo", status: "pending" },
    { doc_type: "id_card_front", status: "pending" },
    { doc_type: "id_card_back", status: "pending" },
    { doc_type: "license_front", status: "approved" },
    { doc_type: "license_back", status: "approved" },
    { doc_type: "insurance", status: "approved" },
    { doc_type: "registration", status: "approved" },
  ],
});
assert.equal(ready.progress, 100);
assert.equal(nextDriverSetupStep(ready), "ready");

// False positive regression: payout_enabled must NEVER influence isPayoutSetupOk
assert.equal(isPayoutSetupOk({ stripe_onboarded: false } as any), false);

console.log("driverSetupProgress.test.ts OK");
