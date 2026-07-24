import assert from "node:assert/strict";
import {
  bearingDegrees,
  buildCustomerTrackingLabels,
  firstNameFromDisplayName,
  resolveCustomerTrackingPhase,
} from "./customerTrackingStatus";

assert.equal(firstNameFromDisplayName("Mamadou Maladho Diallo"), "Mamadou");
assert.equal(firstNameFromDisplayName(""), "");

assert.equal(
  resolveCustomerTrackingPhase("accepted", {
    hasDriver: true,
    hasLiveGps: true,
    etaMinutes: 8,
  }),
  "on_the_way",
);
assert.equal(
  resolveCustomerTrackingPhase("accepted", {
    hasDriver: true,
    hasLiveGps: true,
    etaMinutes: 2,
  }),
  "arriving_soon",
);
assert.equal(
  resolveCustomerTrackingPhase("accepted", {
    hasDriver: true,
    hasLiveGps: false,
    etaMinutes: null,
  }),
  "assigned",
);
assert.equal(
  resolveCustomerTrackingPhase("driver_arrived", {
    hasDriver: true,
    hasLiveGps: true,
    etaMinutes: 0,
  }),
  "arrived",
);

const labels = buildCustomerTrackingLabels({
  status: "accepted",
  hasDriver: true,
  hasLiveGps: true,
  etaMinutes: 2,
  driverName: "Mamadou Diallo",
  distanceLabel: "1.8 mi",
  t: (_key, fallback, vars) => {
    let out = fallback;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        out = out.replace(`{{${k}}}`, String(v));
      }
    }
    return out;
  },
});
assert.match(labels.bannerStatus, /Mamadou/);
assert.match(labels.bannerStatus, /1\.8 mi/);
assert.equal(labels.liveSubtitle, "Driver arriving soon");

const bearing = bearingDegrees(40.65, -73.75, 40.66, -73.75);
assert.ok(bearing != null && bearing >= 0 && bearing < 360);

console.log("customerTrackingStatus.test.ts OK");
