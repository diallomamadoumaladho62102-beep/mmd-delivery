import assert from "node:assert/strict";
import {
  TAXI_CLIENT_CANCEL_REASONS,
  TAXI_DRIVER_CANCEL_REASONS,
  isDriverAtDestination,
  normalizeTaxiCancelReason,
  planClientTaxiCancellation,
  resolveTaxiClientCancelPhase,
} from "./taxiCancellationPolicy";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("phases: before assignment / after accept / after start", () => {
  assert.equal(
    resolveTaxiClientCancelPhase({ status: "paid", driverId: null }),
    "before_assignment",
  );
  assert.equal(
    resolveTaxiClientCancelPhase({ status: "accepted", driverId: "d1" }),
    "after_accept_before_start",
  );
  assert.equal(
    resolveTaxiClientCancelPhase({ status: "driver_arrived", driverId: "d1" }),
    "after_accept_before_start",
  );
  assert.equal(
    resolveTaxiClientCancelPhase({ status: "in_progress", driverId: "d1" }),
    "after_start",
  );
  assert.equal(
    resolveTaxiClientCancelPhase({ status: "completed", driverId: "d1" }),
    "not_cancellable",
  );
});

test("before assignment: full refund when paid", () => {
  const plan = planClientTaxiCancellation({
    status: "dispatching",
    driverId: null,
    paymentStatus: "paid",
    totalCents: 5000,
    driverPayoutCents: 3500,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.phase, "before_assignment");
  if (plan.phase !== "before_assignment") return;
  assert.equal(plan.refundCents, 5000);
  assert.equal(plan.cancelFeeCents, 0);
  assert.equal(plan.refundPolicy, "FULL");
});

test("after accept before start: 30% fee, 70% refund", () => {
  const plan = planClientTaxiCancellation({
    status: "accepted",
    driverId: "d1",
    paymentStatus: "paid",
    totalCents: 10000,
    driverPayoutCents: 7000,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok || plan.phase !== "after_accept_before_start") {
    throw new Error("expected after_accept_before_start");
  }
  assert.equal(plan.cancelFeeCents, 3000);
  assert.equal(plan.refundCents, 7000);
  assert.equal(plan.clientFeePct, 30);
  assert.equal(plan.driverCompensationCents, 0);
});

test("after start not at dest: 100% keep, driver 50%", () => {
  const plan = planClientTaxiCancellation({
    status: "in_progress",
    driverId: "d1",
    paymentStatus: "paid",
    totalCents: 10000,
    driverPayoutCents: 7000,
    driverAtDestination: false,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok || plan.phase !== "after_start") {
    throw new Error("expected after_start");
  }
  assert.equal(plan.refundCents, 0);
  assert.equal(plan.cancelFeeCents, 10000);
  assert.equal(plan.driverCompensationCents, 3500);
  assert.equal(plan.driverCompensationPct, 50);
});

test("after start at dest: driver 100% of payout", () => {
  const plan = planClientTaxiCancellation({
    status: "in_progress",
    driverId: "d1",
    paymentStatus: "paid",
    totalCents: 10000,
    driverPayoutCents: 7000,
    driverAtDestination: true,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok || plan.phase !== "after_start") {
    throw new Error("expected after_start");
  }
  assert.equal(plan.driverCompensationCents, 7000);
  assert.equal(plan.driverCompensationPct, 100);
});

test("destination arrival uses GPS radius", () => {
  assert.equal(
    isDriverAtDestination({
      driverLat: 40.7484,
      driverLng: -73.9857,
      dropoffLat: 40.7485,
      dropoffLng: -73.9857,
      maxMeters: 150,
    }),
    true,
  );
  assert.equal(
    isDriverAtDestination({
      driverLat: 40.7484,
      driverLng: -73.9857,
      dropoffLat: 40.8,
      dropoffLng: -73.98,
      maxMeters: 150,
    }),
    false,
  );
});

test("cancel reasons whitelist", () => {
  assert.equal(
    normalizeTaxiCancelReason("changed_mind", TAXI_CLIENT_CANCEL_REASONS),
    "changed_mind",
  );
  assert.equal(
    normalizeTaxiCancelReason("hacked", TAXI_CLIENT_CANCEL_REASONS),
    null,
  );
  assert.equal(
    normalizeTaxiCancelReason("vehicle_issue", TAXI_DRIVER_CANCEL_REASONS),
    "vehicle_issue",
  );
});

console.log("taxiCancellationPolicy regression passed");
