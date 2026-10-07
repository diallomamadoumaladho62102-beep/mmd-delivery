/**
 * Taxi wait-timer start decisions.
 * Timestamps come from the server. A client cannot supply wait duration or fee.
 * A second arrival does not move the original start.
 */

export type TaxiWaitProximity =
  | { ok: true; distanceMeters: number }
  | { ok: false; error: string; distanceMeters: number | null };

export type TaxiWaitStartDecision =
  | {
      action: "idempotent";
      driverArrivedAt: string;
      waitTimerStartedAt: string;
    }
  | { action: "start"; startedAt: string; distanceMeters: number }
  | { action: "backfill"; startedAt: string; distanceMeters: number | null }
  | { action: "reject"; error: string };

export function resolveTaxiWaitStart(input: {
  status: string;
  driverArrivedAt: string | null;
  waitTimerStartedAt: string | null;
  nowIso: string;
  proximity: TaxiWaitProximity;
}): TaxiWaitStartDecision {
  const status = String(input.status ?? "")
    .trim()
    .toLowerCase();

  if (status !== "accepted" && status !== "driver_arrived") {
    return { action: "reject", error: "invalid_status_for_taxi_arrival" };
  }

  if (input.waitTimerStartedAt) {
    return {
      action: "idempotent",
      driverArrivedAt: input.driverArrivedAt ?? input.waitTimerStartedAt,
      waitTimerStartedAt: input.waitTimerStartedAt,
    };
  }

  if (input.driverArrivedAt) {
    return {
      action: "backfill",
      startedAt: input.driverArrivedAt,
      distanceMeters: input.proximity.ok ? input.proximity.distanceMeters : null,
    };
  }

  if (status !== "accepted") {
    return { action: "reject", error: "invalid_status_for_taxi_arrival" };
  }

  if (input.proximity.ok === false) {
    return { action: "reject", error: input.proximity.error };
  }

  return {
    action: "start",
    startedAt: input.nowIso,
    distanceMeters: input.proximity.distanceMeters,
  };
}
