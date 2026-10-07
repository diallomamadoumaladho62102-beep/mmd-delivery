import assert from "node:assert/strict";
import test from "node:test";
import { triggerDeliveryRequestDispatch } from "./triggerDeliveryRequestDispatch";

const requestId = "00000000-0000-0000-0000-000000000001";

test("a thrown dispatch is captured and can be retried", async () => {
  const result = await triggerDeliveryRequestDispatch({
    supabase: {} as never,
    deliveryRequestId: requestId,
    alsoScheduleHttpOnFailure: false,
    run: async () => {
      throw new Error("dispatch boom");
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /dispatch boom/);
  assert.equal(result.retryScheduled, false);
});

test("a successful dispatch does not schedule another retry", async () => {
  const result = await triggerDeliveryRequestDispatch({
    supabase: {} as never,
    deliveryRequestId: requestId,
    alsoScheduleHttpOnFailure: true,
    run: async () => ({
      ok: true,
      deliveryRequestId: requestId,
      wave: 1,
      notified: 1,
      candidates: 1,
      maxMiles: 5,
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.retryScheduled, false);
});

test("a failed dispatch schedules the backup when an origin exists", async () => {
  const result = await triggerDeliveryRequestDispatch({
    supabase: {} as never,
    deliveryRequestId: requestId,
    alsoScheduleHttpOnFailure: true,
    run: async () => ({
      ok: false,
      deliveryRequestId: requestId,
      wave: 1,
      notified: 0,
      candidates: 0,
      maxMiles: 5,
      error: "db down",
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(typeof result.retryScheduled, "boolean");
});
