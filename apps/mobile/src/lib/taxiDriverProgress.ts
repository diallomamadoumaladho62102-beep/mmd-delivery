/**
 * Next authorized taxi step.
 * The server functions use the same error codes. The phone only mirrors them.
 */

export type TaxiStopProgress = {
  stopOrder: number;
  status?: string | null;
};

export type TaxiStopDecision =
  | { ok: true; idempotent: boolean }
  | { ok: false; error: string };

function stopStatus(stop: TaxiStopProgress): string {
  return String(stop.status ?? "pending").trim().toLowerCase();
}

export function sortStopsByOrder<T extends { stopOrder: number }>(stops: T[]): T[] {
  return stops.slice().sort((a, b) => a.stopOrder - b.stopOrder);
}

export function nextOpenStop<T extends TaxiStopProgress>(stops: T[]): T | null {
  return sortStopsByOrder(stops).find((stop) => stopStatus(stop) !== "completed") ?? null;
}

export function evaluateTaxiStopAction(input: {
  rideStatus: string;
  stops: TaxiStopProgress[];
  stopOrder: number;
  action: "arrive" | "complete";
}): TaxiStopDecision {
  if (String(input.rideStatus ?? "").trim().toLowerCase() !== "in_progress") {
    return { ok: false, error: "invalid_status" };
  }

  const ordered = sortStopsByOrder(input.stops);
  const target = ordered.find((stop) => stop.stopOrder === input.stopOrder);
  if (!target) return { ok: false, error: "stop_not_found" };

  const status = stopStatus(target);
  if (status === "completed") return { ok: true, idempotent: true };

  const open = ordered.find((stop) => stopStatus(stop) !== "completed");
  if (!open || open.stopOrder !== input.stopOrder) {
    return { ok: false, error: "stop_out_of_order" };
  }

  if (input.action === "arrive") {
    if (status === "arrived") return { ok: true, idempotent: true };
    return { ok: true, idempotent: false };
  }

  if (status !== "arrived") return { ok: false, error: "stop_not_arrived" };
  return { ok: true, idempotent: false };
}

/** GPS proximity stays in the SQL function. This only adds the stop gate. */
export function evaluateTaxiRideCompletion(input: {
  rideStatus: string;
  stops: Array<{ status?: string | null }>;
}): TaxiStopDecision {
  const status = String(input.rideStatus ?? "").trim().toLowerCase();
  if (status === "completed") return { ok: false, error: "invalid_status" };
  if (status !== "in_progress") return { ok: false, error: "invalid_status" };
  const open = input.stops.some(
    (stop) => String(stop.status ?? "pending").trim().toLowerCase() !== "completed",
  );
  if (open) return { ok: false, error: "stops_incomplete" };
  return { ok: true, idempotent: false };
}

export type TaxiNavPoint = {
  latitude: number;
  longitude: number;
  address: string;
};

export type TaxiNavigationPlan = {
  stage: "pickup" | "dropoff";
  activeRole: "pickup" | "stop" | "dropoff";
  activeOrder: number | null;
  activeAddress: string;
  destination: { latitude: number; longitude: number } | null;
  /** Incomplete stops, in stop_order, before the final dropoff. */
  waypoints: Array<{ latitude: number; longitude: number }>;
  holdStageArrival: boolean;
};

export function resolveTaxiNavigationPlan(input: {
  rideStatus: string;
  pickup: TaxiNavPoint | null;
  dropoff: TaxiNavPoint | null;
  stops: Array<
    TaxiStopProgress & {
      address?: string | null;
      latitude?: number | null;
      longitude?: number | null;
    }
  >;
}): TaxiNavigationPlan {
  const rideStatus = String(input.rideStatus ?? "").trim().toLowerCase();
  const started = rideStatus === "in_progress";
  const open = nextOpenStop(input.stops);

  if (!started) {
    return {
      stage: "pickup",
      activeRole: "pickup",
      activeOrder: null,
      activeAddress: input.pickup?.address ?? "",
      destination: input.pickup
        ? { latitude: input.pickup.latitude, longitude: input.pickup.longitude }
        : null,
      waypoints: [],
      holdStageArrival: false,
    };
  }

  const remaining = sortStopsByOrder(input.stops).filter(
    (stop) => stopStatus(stop) !== "completed",
  );
  const waypoints = remaining.flatMap((stop) => {
    const latitude = Number(stop.latitude);
    const longitude = Number(stop.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    return [{ latitude, longitude }];
  });

  if (open) {
    return {
      stage: "dropoff",
      activeRole: "stop",
      activeOrder: open.stopOrder,
      activeAddress: String(open.address ?? ""),
      destination: input.dropoff
        ? { latitude: input.dropoff.latitude, longitude: input.dropoff.longitude }
        : null,
      waypoints,
      holdStageArrival: true,
    };
  }

  return {
    stage: "dropoff",
    activeRole: "dropoff",
    activeOrder: null,
    activeAddress: input.dropoff?.address ?? "",
    destination: input.dropoff
      ? { latitude: input.dropoff.latitude, longitude: input.dropoff.longitude }
      : null,
    waypoints: [],
    holdStageArrival: false,
  };
}
