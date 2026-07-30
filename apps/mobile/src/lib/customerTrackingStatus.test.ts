import assert from "node:assert/strict";
import {
  bearingDegrees,
  buildCustomerTrackingLabels,
  firstNameFromDisplayName,
  isTaxiAwaitingPayment,
  resolveCustomerTrackingPhase,
} from "./customerTrackingStatus";

assert.equal(firstNameFromDisplayName("Mamadou Maladho Diallo"), "Mamadou");
assert.equal(firstNameFromDisplayName(""), "");

assert.equal(
  isTaxiAwaitingPayment({ status: "quoted", paymentStatus: "unpaid" }),
  true,
);
assert.equal(
  isTaxiAwaitingPayment({
    status: "pending_payment",
    paymentStatus: "processing",
  }),
  true,
);
assert.equal(
  isTaxiAwaitingPayment({ status: "paid", paymentStatus: "paid" }),
  false,
);

assert.equal(
  resolveCustomerTrackingPhase("quoted", {
    hasDriver: false,
    hasLiveGps: false,
    etaMinutes: null,
    paymentStatus: "unpaid",
  }),
  "awaiting_payment",
);
assert.equal(
  resolveCustomerTrackingPhase("pending_payment", {
    hasDriver: false,
    hasLiveGps: false,
    etaMinutes: null,
    paymentStatus: "processing",
  }),
  "awaiting_payment",
);
assert.equal(
  resolveCustomerTrackingPhase("paid", {
    hasDriver: false,
    hasLiveGps: false,
    etaMinutes: null,
    paymentStatus: "paid",
  }),
  "searching",
);
assert.equal(
  resolveCustomerTrackingPhase("dispatching", {
    hasDriver: false,
    hasLiveGps: false,
    etaMinutes: null,
    paymentStatus: "paid",
  }),
  "searching",
);

assert.equal(
  resolveCustomerTrackingPhase("accepted", {
    hasDriver: true,
    hasLiveGps: true,
    etaMinutes: 8,
    paymentStatus: "paid",
  }),
  "on_the_way",
);
assert.equal(
  resolveCustomerTrackingPhase("accepted", {
    hasDriver: true,
    hasLiveGps: true,
    etaMinutes: 2,
    paymentStatus: "paid",
  }),
  "arriving_soon",
);
assert.equal(
  resolveCustomerTrackingPhase("accepted", {
    hasDriver: true,
    hasLiveGps: false,
    etaMinutes: null,
    paymentStatus: "paid",
  }),
  "assigned",
);
assert.equal(
  resolveCustomerTrackingPhase("driver_arrived", {
    hasDriver: true,
    hasLiveGps: true,
    etaMinutes: 0,
    paymentStatus: "paid",
  }),
  "arrived",
);

const awaitingLabels = buildCustomerTrackingLabels({
  status: "quoted",
  paymentStatus: "unpaid",
  hasDriver: false,
  hasLiveGps: false,
  etaMinutes: null,
  driverName: null,
  distanceLabel: null,
  t: (_key, fallback) => fallback,
});
assert.equal(awaitingLabels.phase, "awaiting_payment");
assert.match(awaitingLabels.bannerStatus, /payment/i);

const labels = buildCustomerTrackingLabels({
  status: "accepted",
  paymentStatus: "paid",
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
