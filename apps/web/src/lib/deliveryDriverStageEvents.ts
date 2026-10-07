import type { SupabaseClient } from "@supabase/supabase-js";
import { logWaitTimerEvent } from "@/lib/waitTimerService";
import { notifyClientDriverArrivedPickup } from "@/lib/clientPushNotifications";

export const DELIVERY_PICKUP_ARRIVAL_EVENT = "driver_arrived_pickup";

export type DeliveryStageEntityType = "order" | "delivery_request";

type ArrivalRow = {
  id: string;
  status: string | null;
  driver_id: string | null;
  client_user_id?: string | null;
  created_by?: string | null;
  user_id?: string | null;
  client_id?: string | null;
};

function tableFor(entityType: DeliveryStageEntityType) {
  return entityType === "delivery_request" ? "delivery_requests" : "orders";
}

function normalizeStatus(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export async function findDeliveryPickupArrivalEvent(
  supabaseAdmin: SupabaseClient,
  entityType: DeliveryStageEntityType,
  entityId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("wait_timer_events")
    .select("id,created_at")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("event_type", DELIVERY_PICKUP_ARRIVAL_EVENT)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { error: error.message };
  return { event: data ?? null };
}

export async function recordDeliveryPickupArrival(params: {
  supabaseAdmin: SupabaseClient;
  entityType: DeliveryStageEntityType;
  entityId: string;
  driverUserId: string;
  driverLat?: number | null;
  driverLng?: number | null;
}) {
  const table = tableFor(params.entityType);
  const { data, error } = await params.supabaseAdmin
    .from(table)
    .select(
      "id,status,driver_id,client_user_id,created_by,user_id,client_id",
    )
    .eq("id", params.entityId)
    .maybeSingle();

  if (error) return { ok: false as const, error: error.message, status: 500 };
  if (!data) return { ok: false as const, error: "entity_not_found", status: 404 };

  const row = data as ArrivalRow;
  if (String(row.driver_id ?? "") !== params.driverUserId) {
    return { ok: false as const, error: "forbidden_not_assigned_driver", status: 403 };
  }

  const status = normalizeStatus(row.status);
  if (status !== "dispatched") {
    return { ok: false as const, error: "invalid_status_for_pickup_arrival", status: 409 };
  }

  const existing = await findDeliveryPickupArrivalEvent(
    params.supabaseAdmin,
    params.entityType,
    params.entityId,
  );
  if ("error" in existing && existing.error) {
    return { ok: false as const, error: existing.error, status: 500 };
  }
  if (existing.event?.id) {
    return {
      ok: true as const,
      already: true,
      arrived_at: existing.event.created_at ?? null,
    };
  }

  await logWaitTimerEvent(params.supabaseAdmin, {
    entityType: params.entityType,
    entityId: params.entityId,
    eventType: DELIVERY_PICKUP_ARRIVAL_EVENT,
    actorId: params.driverUserId,
    triggeredRole: "driver",
    description: "Driver arrived at pickup",
    metadata: {
      driver_lat: params.driverLat ?? null,
      driver_lng: params.driverLng ?? null,
    },
  });

  const clientUserIds = [
    row.client_user_id,
    row.created_by,
    row.user_id,
    row.client_id,
  ];

  await notifyClientDriverArrivedPickup({
    supabaseAdmin: params.supabaseAdmin,
    userIds: clientUserIds,
    entityType: params.entityType,
    entityId: params.entityId,
  });

  return {
    ok: true as const,
    already: false,
    arrived_at: new Date().toISOString(),
  };
}
