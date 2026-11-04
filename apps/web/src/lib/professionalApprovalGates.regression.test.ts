/**
 * Regression: pending professionals cannot use approved-only capabilities.
 * Pure policy checks mirroring production gates (no DB writes).
 */
import assert from "node:assert/strict";

function sellerCanPublish(status: string | null | undefined): boolean {
  return String(status ?? "").toLowerCase() === "approved";
}

function driverCanGoOnline(input: {
  status?: string | null;
  vehicleReview?: string | null;
}): { ok: boolean; error?: string } {
  if (String(input.status ?? "").toLowerCase() !== "approved") {
    return { ok: false, error: "driver_not_approved" };
  }
  const review = String(input.vehicleReview ?? "").toLowerCase();
  if (review === "pending_review") {
    return { ok: false, error: "vehicle_pending_review" };
  }
  return { ok: true };
}

function restaurantCanAccept(input: {
  status?: string | null;
  isAccepting?: boolean | null;
  isBusy?: boolean | null;
}): { ok: boolean; error?: string } {
  if (String(input.status ?? "").toLowerCase() !== "approved") {
    return { ok: false, error: "restaurant_not_approved" };
  }
  if (input.isAccepting !== true) {
    return { ok: false, error: "restaurant_not_accepting_orders" };
  }
  if (input.isBusy === true) {
    return { ok: false, error: "restaurant_busy" };
  }
  return { ok: true };
}

assert.equal(sellerCanPublish("pending"), false);
assert.equal(sellerCanPublish("approved"), true);
assert.equal(sellerCanPublish("suspended"), false);

assert.equal(driverCanGoOnline({ status: "pending" }).ok, false);
assert.equal(driverCanGoOnline({ status: "approved", vehicleReview: "pending_review" }).error, "vehicle_pending_review");
assert.equal(driverCanGoOnline({ status: "approved", vehicleReview: "approved" }).ok, true);

assert.equal(restaurantCanAccept({ status: "pending", isAccepting: true }).ok, false);
assert.equal(restaurantCanAccept({ status: "approved", isAccepting: false }).ok, false);
assert.equal(restaurantCanAccept({ status: "approved", isAccepting: true, isBusy: true }).ok, false);
assert.equal(restaurantCanAccept({ status: "approved", isAccepting: true }).ok, true);

console.log("professionalApprovalGates.regression.test.ts — PASS");
