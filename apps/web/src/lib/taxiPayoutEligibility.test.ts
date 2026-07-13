import assert from "node:assert/strict";
import { evaluateTaxiPayoutEligibility } from "./taxiPayoutEligibility";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`fail - ${name}`);
    throw error;
  }
}

const base = {
  rideStatus: "completed",
  paymentStatus: "paid",
  refundStatus: null as string | null,
  driverId: "drv_1",
  driverCents: 1500,
  driverPaidOut: false,
  driverTransferId: null as string | null,
  completedAt: "2026-07-01T00:00:00.000Z",
  holdUntilMs: 24 * 60 * 60 * 1000,
  nowMs: Date.parse("2026-07-13T00:00:00.000Z"),
  connectReady: true as boolean | null,
};

test("eligible paid completed ride", () => {
  const result = evaluateTaxiPayoutEligibility(base);
  assert.deepEqual(result, { ok: true, alreadyPaid: false });
});

test("already paid is idempotent success", () => {
  const result = evaluateTaxiPayoutEligibility({
    ...base,
    driverPaidOut: true,
    driverTransferId: "tr_123",
  });
  assert.deepEqual(result, { ok: true, alreadyPaid: true });
});

test("blocks unpaid ride", () => {
  const result = evaluateTaxiPayoutEligibility({
    ...base,
    paymentStatus: "unpaid",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "ride_not_paid");
});

test("blocks refunded ride", () => {
  const result = evaluateTaxiPayoutEligibility({
    ...base,
    refundStatus: "refunded",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "refund_or_dispute");
});

test("blocks zero/negative amount", () => {
  const result = evaluateTaxiPayoutEligibility({ ...base, driverCents: 0 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "invalid_amount");
});

test("blocks hold window", () => {
  const result = evaluateTaxiPayoutEligibility({
    ...base,
    completedAt: "2026-07-12T12:00:00.000Z",
    nowMs: Date.parse("2026-07-12T18:00:00.000Z"),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "hold_window");
});

test("blocks connect not ready", () => {
  const result = evaluateTaxiPayoutEligibility({
    ...base,
    connectReady: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "connect_not_ready");
});

console.log("taxiPayoutEligibility tests passed");
