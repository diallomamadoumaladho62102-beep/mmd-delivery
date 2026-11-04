import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GUINEA_ISOLATED_TEST_USER_IDS,
  isGuineaIsolatedTestUserId,
} from "@/lib/guineaTestIsolation";
import {
  assertTaxiDropoffProximity,
  assertTaxiPickupProximity,
} from "@/lib/taxiProximityGate";
import { logTaxiEventServer } from "@/lib/taxiEvents";

/** Existing Guinea rehearsal driver — never approve publicly. */
export const GUINEA_ISOLATED_TEST_DRIVER_USER_ID =
  "05c34009-b050-454c-a94d-c4c803b26815";
export const GUINEA_ISOLATED_TEST_CLIENT_USER_ID =
  "9e0b3fb4-b23a-407c-a781-9f63f9b3de50";

const ISOLATED_TAXI_STATUSES = [
  "accepted",
  "driver_arrived",
  "in_progress",
  "completed",
  "cancelled",
] as const;

type IsolatedTaxiStatus = (typeof ISOLATED_TAXI_STATUSES)[number];

export type IsolatedTaxiRideRow = {
  id: string;
  status: string | null;
  client_user_id: string | null;
  driver_id: string | null;
  preferred_driver_id: string | null;
  is_test: boolean | null;
  hidden_from_user: boolean | null;
  archived_at: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  pickup_verification_code: string | null;
  payment_status: string | null;
  payment_method: string | null;
  currency: string | null;
  total_cents: number | null;
  country_code: string | null;
};

function assertActorIsIsolatedTestAccount(userId: string) {
  if (!isGuineaIsolatedTestUserId(userId)) {
    throw new Error("guinea_isolated_actor_required");
  }
}

export function isGuineaIsolatedTaxiRide(row: {
  is_test?: boolean | null;
  client_user_id?: string | null;
  driver_id?: string | null;
  preferred_driver_id?: string | null;
}): boolean {
  if (row.is_test !== true) return false;
  const parties = [row.client_user_id, row.driver_id, row.preferred_driver_id];
  return parties.every(
    (id) => !id || isGuineaIsolatedTestUserId(id),
  ) && parties.some((id) => isGuineaIsolatedTestUserId(id));
}

export async function loadIsolatedTaxiRide(
  admin: SupabaseClient,
  rideId: string,
): Promise<IsolatedTaxiRideRow> {
  const { data, error } = await admin
    .from("taxi_rides")
    .select(
      "id,status,client_user_id,driver_id,preferred_driver_id,is_test,hidden_from_user,archived_at,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,pickup_verification_code,payment_status,payment_method,currency,total_cents,country_code",
    )
    .eq("id", rideId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("ride_not_found");
  if (!isGuineaIsolatedTaxiRide(data)) {
    throw new Error("guinea_isolated_ride_required");
  }
  return data as IsolatedTaxiRideRow;
}

/**
 * Marks a cash Guinea create as an isolated rehearsal ride and assigns the
 * existing Guinea test driver immediately. Status is never left as open
 * dispatching with a null driver_id, so production retry-taxi-dispatch cannot
 * offer the ride to a real driver even before this tree is deployed.
 */
export function isolatedGuineaTaxiCreateFields(clientUserId: string) {
  assertActorIsIsolatedTestAccount(clientUserId);
  return {
    client_user_id: clientUserId,
    preferred_driver_id: GUINEA_ISOLATED_TEST_DRIVER_USER_ID,
    driver_id: GUINEA_ISOLATED_TEST_DRIVER_USER_ID,
    status: "accepted" as const,
    is_test: true,
    hidden_from_user: true,
    dispatch_wave: 0,
  };
}

export async function transitionIsolatedTaxiRide(params: {
  admin: SupabaseClient;
  actorUserId: string;
  rideId: string;
  action: "arrive" | "start" | "complete" | "cancel";
  lat?: number;
  lng?: number;
  pickupCode?: string;
}): Promise<{ ride: IsolatedTaxiRideRow; previousStatus: string }> {
  assertActorIsIsolatedTestAccount(params.actorUserId);
  const ride = await loadIsolatedTaxiRide(params.admin, params.rideId);
  const previousStatus = String(ride.status ?? "").toLowerCase();
  const nowIso = new Date().toISOString();

  const isClient = params.actorUserId === ride.client_user_id;
  const isDriver = params.actorUserId === ride.driver_id;

  if (params.action === "cancel") {
    if (!isClient && !isDriver) throw new Error("forbidden");
    if (["completed", "cancelled"].includes(previousStatus)) {
      throw new Error("invalid_status");
    }
    const { data, error } = await params.admin
      .from("taxi_rides")
      .update({
        status: "cancelled",
        cancelled_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", ride.id)
      .select(
        "id,status,client_user_id,driver_id,preferred_driver_id,is_test,hidden_from_user,archived_at,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,pickup_verification_code,payment_status,payment_method,currency,total_cents,country_code",
      )
      .single();
    if (error) throw new Error(error.message);
    await logTaxiEventServer(params.admin, {
      rideId: ride.id,
      eventType: "guinea_isolated_cancelled",
      oldStatus: previousStatus,
      newStatus: "cancelled",
      actorId: params.actorUserId,
      triggeredRole: isDriver ? "driver" : "client",
      description: "Isolated Guinea rehearsal ride cancelled",
    });
    return { ride: data as IsolatedTaxiRideRow, previousStatus };
  }

  if (!isDriver) throw new Error("driver_actor_required");

  let nextStatus: IsolatedTaxiStatus;
  const patch: Record<string, unknown> = { updated_at: nowIso };

  if (params.action === "arrive") {
    if (previousStatus !== "accepted") throw new Error("invalid_status");
    if (params.lat == null || params.lng == null) throw new Error("driver_gps_required");
    const proximity = assertTaxiPickupProximity({
      driverLat: params.lat,
      driverLng: params.lng,
      pickupLat: ride.pickup_lat,
      pickupLng: ride.pickup_lng,
    });
    if (proximity.ok === false) {
      throw new Error(proximity.error);
    }
    nextStatus = "driver_arrived";
    patch.status = nextStatus;
    patch.driver_arrived_at = nowIso;
  } else if (params.action === "start") {
    if (previousStatus !== "driver_arrived") throw new Error("invalid_status");
    const code = String(params.pickupCode ?? "").replace(/\D/g, "").slice(0, 4);
    if (code.length !== 4) throw new Error("pickup_code_required");
    const expected = String(ride.pickup_verification_code ?? "").trim();
    if (!expected || code !== expected) throw new Error("invalid_pickup_code");
    nextStatus = "in_progress";
    patch.status = nextStatus;
    patch.started_at = nowIso;
  } else if (params.action === "complete") {
    if (previousStatus !== "in_progress") throw new Error("invalid_status");
    if (params.lat == null || params.lng == null) throw new Error("driver_gps_required");
    const proximity = assertTaxiDropoffProximity({
      driverLat: params.lat,
      driverLng: params.lng,
      dropoffLat: ride.dropoff_lat,
      dropoffLng: ride.dropoff_lng,
    });
    if (proximity.ok === false) {
      throw new Error(proximity.error);
    }
    nextStatus = "completed";
    patch.status = nextStatus;
    patch.completed_at = nowIso;
    if (String(ride.payment_method ?? "").toLowerCase() === "cash") {
      patch.payment_status = "cash_collected";
    }
  } else {
    throw new Error("unsupported_action");
  }

  const { data, error } = await params.admin
    .from("taxi_rides")
    .update(patch)
    .eq("id", ride.id)
    .eq("status", previousStatus)
    .select(
      "id,status,client_user_id,driver_id,preferred_driver_id,is_test,hidden_from_user,archived_at,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,pickup_verification_code,payment_status,payment_method,currency,total_cents,country_code",
    )
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("status_race");

  await logTaxiEventServer(params.admin, {
    rideId: ride.id,
    eventType: `guinea_isolated_${params.action}`,
    oldStatus: previousStatus,
    newStatus: nextStatus,
    actorId: params.actorUserId,
    triggeredRole: "driver",
    description: `Isolated Guinea taxi ${params.action}`,
  });

  return { ride: data as IsolatedTaxiRideRow, previousStatus };
}

export function guineaIsolatedAccountsSnapshot() {
  return {
    clientUserId: GUINEA_ISOLATED_TEST_CLIENT_USER_ID,
    driverUserId: GUINEA_ISOLATED_TEST_DRIVER_USER_ID,
    allUserIds: [...GUINEA_ISOLATED_TEST_USER_IDS],
  };
}
