import type { SupabaseClient } from "@supabase/supabase-js";
import { distanceMeters } from "@/lib/driverZones";
import { computeWaitTimerState } from "@/lib/waitFeeCalculator";
import {
  DRIVER_ARRIVAL_MANUAL_REVIEW_METERS,
  DRIVER_ARRIVAL_MAX_METERS,
  isWaitTimerGpsValidated,
  type WaitTimerEntityType,
  type WaitTimerRow,
} from "@/lib/waitTimerTypes";

type EntityContext = {
  entityType: WaitTimerEntityType;
  entityId: string;
  table: "orders" | "delivery_requests" | "taxi_rides";
  entityKind: "delivery" | "taxi";
  targetLat: number | null;
  targetLng: number | null;
  row: WaitTimerRow;
  clientUserIds: string[];
  orderIdForEvents?: string | null;
};

function tableForEntity(entityType: WaitTimerEntityType) {
  switch (entityType) {
    case "order":
      return "orders" as const;
    case "delivery_request":
      return "delivery_requests" as const;
    case "taxi_ride":
      return "taxi_rides" as const;
  }
}

const ENTITY_SELECT_BASE = `
  id,
  status,
  driver_id,
  currency,
  driver_arrived_at,
  wait_timer_started_at,
  free_wait_minutes,
  wait_fee_amount_cents,
  wait_fee_currency,
  wait_fee_minutes,
  wait_fee_status,
  dropoff_photo_url,
  completion_reason,
  cancellation_exempt,
  cancellation_exempt_reason,
  driver_distance_to_target_meters,
  customer_no_show_validated,
  leave_at_door,
  manual_arrival_required,
  client_wait_arrived_notified_at,
  client_wait_fee_started_notified_at,
  client_wait_final_warning_notified_at,
  pickup_lat,
  pickup_lng,
  dropoff_lat,
  dropoff_lng,
  total_cents,
  client_user_id,
  created_by,
  user_id
`;

/** Orders/taxi use driver_payout_cents; Delivery Requests use driver_delivery_payout (dollars). */
function selectForEntity(entityType: WaitTimerEntityType): string {
  if (entityType === "delivery_request") {
    return `${ENTITY_SELECT_BASE}, driver_delivery_payout`;
  }
  return `${ENTITY_SELECT_BASE}, driver_payout_cents`;
}

export async function logWaitTimerEvent(
  supabaseAdmin: SupabaseClient,
  input: {
    entityType: WaitTimerEntityType;
    entityId: string;
    eventType: string;
    actorId?: string | null;
    triggeredRole?: string | null;
    description?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await supabaseAdmin.from("wait_timer_events").insert({
    entity_type: input.entityType,
    entity_id: input.entityId,
    event_type: input.eventType,
    actor_id: input.actorId ?? null,
    triggered_role: input.triggeredRole ?? null,
    description: input.description ?? null,
    metadata: input.metadata ?? {},
  });
}

async function logOrderEvent(
  supabaseAdmin: SupabaseClient,
  input: {
    orderId: string;
    eventType: string;
    actorId: string;
    description: string;
    metadata?: Record<string, unknown>;
    oldStatus?: string | null;
    newStatus?: string | null;
  }
) {
  await supabaseAdmin.from("order_events").insert({
    order_id: input.orderId,
    event_type: input.eventType,
    old_status: input.oldStatus ?? null,
    new_status: input.newStatus ?? null,
    description: input.description,
    actor_id: input.actorId,
    triggered_by: input.actorId,
    triggered_role: "driver",
    metadata: input.metadata ?? {},
  });
}

export async function loadWaitTimerEntity(
  supabaseAdmin: SupabaseClient,
  entityType: WaitTimerEntityType,
  entityId: string,
  driverUserId: string,
  opts?: { requireArrivalEligibleStatus?: boolean }
): Promise<EntityContext | { error: string }> {
  const table = tableForEntity(entityType);
  const { data, error } = await supabaseAdmin
    .from(table)
    .select(selectForEntity(entityType))
    .eq("id", entityId)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: "entity_not_found" };

  const raw = data as WaitTimerRow & {
    client_user_id?: string | null;
    created_by?: string | null;
    user_id?: string | null;
    driver_delivery_payout?: number | null;
    driver_payout_cents?: number | null;
  };

  // Normalize Delivery Request payout dollars → cents for shared wait-timer math.
  const row = {
    ...raw,
    driver_payout_cents:
      raw.driver_payout_cents != null
        ? Number(raw.driver_payout_cents)
        : raw.driver_delivery_payout != null
          ? Math.round(Number(raw.driver_delivery_payout) * 100)
          : null,
  } as WaitTimerRow & {
    client_user_id?: string | null;
    created_by?: string | null;
    user_id?: string | null;
  };

  if (String(row.driver_id ?? "") !== driverUserId) {
    return { error: "forbidden_not_assigned_driver" };
  }

  let entityKind: "delivery" | "taxi" = entityType === "taxi_ride" ? "taxi" : "delivery";
  let targetLat: number | null = null;
  let targetLng: number | null = null;

  if (entityType === "taxi_ride") {
    targetLat = row.pickup_lat != null ? Number(row.pickup_lat) : null;
    targetLng = row.pickup_lng != null ? Number(row.pickup_lng) : null;
  } else {
    targetLat = row.dropoff_lat != null ? Number(row.dropoff_lat) : null;
    targetLng = row.dropoff_lng != null ? Number(row.dropoff_lng) : null;
  }

  if (opts?.requireArrivalEligibleStatus !== false) {
    if (entityType === "taxi_ride") {
      if (String(row.status ?? "").toLowerCase() !== "accepted") {
        return { error: "invalid_status_for_taxi_arrival" };
      }
    } else if (String(row.status ?? "").toLowerCase() !== "picked_up") {
      return { error: "invalid_status_for_dropoff_arrival" };
    }
  }

  const clientUserIds = [row.client_user_id, row.created_by, row.user_id].filter(
    Boolean
  ) as string[];

  return {
    entityType,
    entityId,
    table,
    entityKind,
    targetLat,
    targetLng,
    row,
    clientUserIds,
    orderIdForEvents: entityType === "order" ? entityId : null,
  };
}

function validateProximity(input: {
  driverLat: number;
  driverLng: number;
  targetLat: number | null;
  targetLng: number | null;
  forceManual?: boolean;
}):
  | { ok: true; distanceMeters: number; manualRequired: boolean }
  | { ok: false; error: string; distanceMeters: number | null } {
  if (input.forceManual) {
    return { ok: true, distanceMeters: 0, manualRequired: true };
  }

  if (input.targetLat == null || input.targetLng == null) {
    return { ok: false, error: "target_coordinates_missing", distanceMeters: null };
  }

  const dist = distanceMeters(
    input.driverLat,
    input.driverLng,
    input.targetLat,
    input.targetLng
  );

  if (dist <= DRIVER_ARRIVAL_MAX_METERS) {
    return { ok: true, distanceMeters: dist, manualRequired: false };
  }

  if (dist <= DRIVER_ARRIVAL_MANUAL_REVIEW_METERS) {
    return { ok: false, error: "manual_arrival_required", distanceMeters: dist };
  }

  return { ok: false, error: "too_far_from_target", distanceMeters: dist };
}

export async function recordDriverArrival(
  supabaseAdmin: SupabaseClient,
  input: {
    entityType: WaitTimerEntityType;
    entityId: string;
    driverUserId: string;
    driverLat: number;
    driverLng: number;
    forceManual?: boolean;
  }
) {
  const ctx = await loadWaitTimerEntity(
    supabaseAdmin,
    input.entityType,
    input.entityId,
    input.driverUserId
  );
  if ("error" in ctx) return { ok: false as const, error: ctx.error };

  if (ctx.row.driver_arrived_at || ctx.row.wait_timer_started_at) {
    return { ok: false as const, error: "already_arrived" };
  }

  const proximity = validateProximity({
    driverLat: input.driverLat,
    driverLng: input.driverLng,
    targetLat: ctx.targetLat,
    targetLng: ctx.targetLng,
    forceManual: input.forceManual,
  });

  if (proximity.ok === false) {
    await logWaitTimerEvent(supabaseAdmin, {
      entityType: input.entityType,
      entityId: input.entityId,
      eventType:
        proximity.error === "manual_arrival_required"
          ? "driver_arrival_manual_required"
          : "driver_arrival_blocked",
      actorId: input.driverUserId,
      triggeredRole: "driver",
      description: "Driver arrival blocked by proximity validation",
      metadata: {
        distance_meters: proximity.distanceMeters,
        driver_lat: input.driverLat,
        driver_lng: input.driverLng,
      },
    });
    return {
      ok: false as const,
      error: proximity.error,
      distance_meters: proximity.distanceMeters,
    };
  }

  const nowIso = new Date().toISOString();
  const currency = String(ctx.row.currency ?? "USD").toUpperCase();
  const update: Record<string, unknown> = {
    driver_arrived_at: nowIso,
    wait_timer_started_at: nowIso,
    wait_fee_status: "free",
    wait_fee_currency: currency,
    driver_distance_to_target_meters: proximity.distanceMeters,
    manual_arrival_required: proximity.manualRequired,
    wait_arrival_lat: input.driverLat,
    wait_arrival_lng: input.driverLng,
    updated_at: nowIso,
  };

  if (input.entityType === "taxi_ride") {
    update.status = "driver_arrived";
  }

  const { error: updateErr } = await supabaseAdmin
    .from(ctx.table)
    .update(update)
    .eq("id", input.entityId)
    .eq("driver_id", input.driverUserId);

  if (updateErr) return { ok: false as const, error: updateErr.message };

  await logWaitTimerEvent(supabaseAdmin, {
    entityType: input.entityType,
    entityId: input.entityId,
    eventType: "driver_arrived",
    actorId: input.driverUserId,
    triggeredRole: "driver",
    description: "Driver arrived — wait timer started",
    metadata: {
      distance_meters: proximity.distanceMeters,
      manual_required: proximity.manualRequired,
    },
  });

  if (ctx.orderIdForEvents) {
    await logOrderEvent(supabaseAdmin, {
      orderId: ctx.orderIdForEvents,
      eventType: "driver_arrived_dropoff",
      actorId: input.driverUserId,
      description: "Driver arrived at delivery location",
      metadata: { distance_meters: proximity.distanceMeters },
      oldStatus: ctx.row.status ?? null,
      newStatus: ctx.row.status ?? null,
    });
  }

  return {
    ok: true as const,
    entity_type: input.entityType,
    entity_id: input.entityId,
    driver_arrived_at: nowIso,
    wait_timer_started_at: nowIso,
    distance_meters: proximity.distanceMeters,
    manual_arrival_required: proximity.manualRequired,
    client_user_ids: ctx.clientUserIds,
    entity_kind: ctx.entityKind,
  };
}

export async function getWaitTimerStatus(
  supabaseAdmin: SupabaseClient,
  input: {
    entityType: WaitTimerEntityType;
    entityId: string;
    driverUserId: string;
  }
) {
  const ctx = await loadWaitTimerEntity(
    supabaseAdmin,
    input.entityType,
    input.entityId,
    input.driverUserId,
    { requireArrivalEligibleStatus: false }
  );
  if ("error" in ctx) return { ok: false as const, error: ctx.error };

  const computed = computeWaitTimerState({
    waitTimerStartedAt: ctx.row.wait_timer_started_at ?? ctx.row.driver_arrived_at,
    freeWaitMinutes: ctx.row.free_wait_minutes ?? undefined,
    leaveAtDoor: Boolean(ctx.row.leave_at_door),
    entityKind: ctx.entityKind,
    driverArrivedAt: ctx.row.driver_arrived_at,
  });

  const nowIso = new Date().toISOString();
  await supabaseAdmin
    .from(ctx.table)
    .update({
      wait_fee_amount_cents: computed.wait_fee_cents,
      wait_fee_minutes: computed.billable_minutes,
      wait_fee_status: computed.wait_fee_status,
      updated_at: nowIso,
    })
    .eq("id", input.entityId);

  const { data: events } = await supabaseAdmin
    .from("wait_timer_events")
    .select("id,event_type,description,metadata,created_at,triggered_role")
    .eq("entity_type", input.entityType)
    .eq("entity_id", input.entityId)
    .order("created_at", { ascending: false })
    .limit(20);

  return {
    ok: true as const,
    entity_type: input.entityType,
    entity_id: input.entityId,
    driver_arrived_at: ctx.row.driver_arrived_at,
    wait_timer_started_at: ctx.row.wait_timer_started_at,
    leave_at_door: Boolean(ctx.row.leave_at_door),
    manual_arrival_required: Boolean(ctx.row.manual_arrival_required),
    customer_no_show_validated: Boolean(ctx.row.customer_no_show_validated),
    cancellation_exempt: Boolean(ctx.row.cancellation_exempt),
    timer: computed,
    history: events ?? [],
    client_user_ids: ctx.clientUserIds,
    entity_kind: ctx.entityKind,
    currency: ctx.row.wait_fee_currency ?? ctx.row.currency ?? "USD",
    notification_flags: {
      arrived: ctx.row.client_wait_arrived_notified_at,
      fee_started: ctx.row.client_wait_fee_started_notified_at,
      final_warning: ctx.row.client_wait_final_warning_notified_at,
    },
  };
}

export async function authorizeDepositAtDoor(
  supabaseAdmin: SupabaseClient,
  input: {
    entityType: "order" | "delivery_request";
    entityId: string;
    driverUserId: string;
    proofPhotoUrl: string;
  }
) {
  const ctx = await loadWaitTimerEntity(
    supabaseAdmin,
    input.entityType,
    input.entityId,
    input.driverUserId
  );
  if ("error" in ctx) return { ok: false as const, error: ctx.error };

  if (!ctx.row.leave_at_door) {
    return { ok: false as const, error: "leave_at_door_not_enabled" };
  }

  const computed = computeWaitTimerState({
    waitTimerStartedAt: ctx.row.wait_timer_started_at ?? ctx.row.driver_arrived_at,
    freeWaitMinutes: ctx.row.free_wait_minutes ?? undefined,
    leaveAtDoor: true,
    entityKind: "delivery",
  });

  if (!computed.can_deposit_at_door) {
    return { ok: false as const, error: "deposit_not_yet_allowed" };
  }

  const proof = String(input.proofPhotoUrl ?? "").trim();
  if (!proof) return { ok: false as const, error: "proof_photo_required" };

  const nowIso = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from(ctx.table)
    .update({
      dropoff_photo_url: proof,
      completion_reason: "left_at_door",
      customer_no_show_validated: true,
      updated_at: nowIso,
    })
    .eq("id", input.entityId);

  if (error) return { ok: false as const, error: error.message };

  await logWaitTimerEvent(supabaseAdmin, {
    entityType: input.entityType,
    entityId: input.entityId,
    eventType: "deposit_at_door",
    actorId: input.driverUserId,
    triggeredRole: "driver",
    description: "Driver authorized to leave order at door with photo",
    metadata: { proof_photo_url: proof },
  });

  if (ctx.orderIdForEvents) {
    await logOrderEvent(supabaseAdmin, {
      orderId: ctx.orderIdForEvents,
      eventType: "deposit_at_door_authorized",
      actorId: input.driverUserId,
      description: "Order may be left at door with proof photo",
      metadata: { proof_photo_url: proof },
    });
  }

  return {
    ok: true as const,
    entity_type: input.entityType,
    entity_id: input.entityId,
    completion_reason: "left_at_door",
    proof_photo_url: proof,
  };
}

export async function cancelTaxiNoShow(
  supabaseAdmin: SupabaseClient,
  input: { rideId: string; driverUserId: string }
) {
  const ctx = await loadWaitTimerEntity(
    supabaseAdmin,
    "taxi_ride",
    input.rideId,
    input.driverUserId,
    { requireArrivalEligibleStatus: false }
  );
  if ("error" in ctx) return { ok: false as const, error: ctx.error };

  const computed = computeWaitTimerState({
    waitTimerStartedAt: ctx.row.wait_timer_started_at ?? ctx.row.driver_arrived_at,
    freeWaitMinutes: ctx.row.free_wait_minutes ?? undefined,
    entityKind: "taxi",
  });

  const gpsValidated = isWaitTimerGpsValidated(ctx.row);
  const waitFeeCents = gpsValidated ? computed.wait_fee_cents : 0;
  const waitFeeMinutes = gpsValidated ? computed.billable_minutes : 0;
  const waitFeeStatus = gpsValidated ? computed.wait_fee_status : "waived";

  if (!computed.can_cancel_no_penalty) {
    return { ok: false as const, error: "no_show_cancel_not_yet_allowed" };
  }

  if (String(ctx.row.status ?? "").toLowerCase() !== "driver_arrived") {
    return { ok: false as const, error: "invalid_status_for_no_show_cancel" };
  }

  const nowIso = new Date().toISOString();
  const currency = String(ctx.row.currency ?? "USD").toUpperCase();
  const ridePriceCents = Number(ctx.row.total_cents ?? 0);
  const compensationCents = Math.round(ridePriceCents * 0.05) + waitFeeCents;

  const { error } = await supabaseAdmin
    .from("taxi_rides")
    .update({
      status: "canceled",
      cancelled_at: nowIso,
      cancellation_exempt: true,
      cancellation_exempt_reason: "customer_no_show_validated",
      customer_no_show_validated: true,
      completion_reason: "customer_no_show",
      wait_fee_amount_cents: waitFeeCents,
      wait_fee_minutes: waitFeeMinutes,
      wait_fee_status: waitFeeStatus,
      updated_at: nowIso,
    })
    .eq("id", input.rideId)
    .eq("driver_id", input.driverUserId);

  if (error) return { ok: false as const, error: error.message };

  await logWaitTimerEvent(supabaseAdmin, {
    entityType: "taxi_ride",
    entityId: input.rideId,
    eventType: "taxi_no_show_cancel",
    actorId: input.driverUserId,
    triggeredRole: "driver",
    description: "Taxi ride canceled without driver penalty — customer no-show",
    metadata: {
      wait_fee_cents: waitFeeCents,
      compensation_cents: compensationCents,
      currency,
      gps_validated: gpsValidated,
    },
  });

  return {
    ok: true as const,
    taxi_ride_id: input.rideId,
    cancellation_exempt: true,
    customer_no_show_validated: true,
    wait_fee_cents: waitFeeCents,
    compensation_cents: compensationCents,
    currency,
    client_user_ids: ctx.clientUserIds,
  };
}

export async function markWaitTimerNotificationSent(
  supabaseAdmin: SupabaseClient,
  input: {
    entityType: WaitTimerEntityType;
    entityId: string;
    field:
      | "client_wait_arrived_notified_at"
      | "client_wait_fee_started_notified_at"
      | "client_wait_final_warning_notified_at";
  }
) {
  const table = tableForEntity(input.entityType);
  await supabaseAdmin
    .from(table)
    .update({ [input.field]: new Date().toISOString() })
    .eq("id", input.entityId);
}
