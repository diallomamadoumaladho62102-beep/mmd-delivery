import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiRole, SharedMissionContext } from "@/lib/ai/aiTypes";

const UUID_RE = /^[0-9a-f-]{36}$/i;

type OrderRow = {
  id: string;
  kind?: string | null;
  status?: string | null;
  payment_status?: string | null;
  pickup_address?: string | null;
  dropoff_address?: string | null;
  restaurant_name?: string | null;
  driver_id?: string | null;
  client_user_id?: string | null;
  client_id?: string | null;
  user_id?: string | null;
  created_by?: string | null;
  restaurant_user_id?: string | null;
  restaurant_id?: string | null;
};

function clientOwnsOrder(order: OrderRow, userId: string): boolean {
  const owners = [
    order.client_user_id,
    order.client_id,
    order.user_id,
    order.created_by,
  ]
    .filter(Boolean)
    .map(String);
  return owners.includes(userId);
}

function driverAssigned(order: OrderRow): boolean {
  return Boolean(order.driver_id && String(order.driver_id).trim());
}

function buildSafeSummary(ctx: Omit<SharedMissionContext, "safeSummary">): string {
  const parts = [
    `Mission ${ctx.missionKind}`,
    ctx.status ? `status ${ctx.status}` : null,
    ctx.pickupAddress ? `from ${ctx.pickupAddress}` : null,
    ctx.dropoffAddress ? `to ${ctx.dropoffAddress}` : null,
    ctx.restaurantName ? `restaurant ${ctx.restaurantName}` : null,
    ctx.driverAssigned ? "driver assigned" : "no driver yet",
  ].filter(Boolean);
  return parts.join(" · ");
}

export async function buildSharedMissionContext(params: {
  supabaseAdmin: SupabaseClient;
  userId: string;
  viewerRole: AiRole;
  orderId?: string;
}): Promise<SharedMissionContext | null> {
  const orderId = String(params.orderId ?? "").trim();
  if (!orderId || !UUID_RE.test(orderId)) {
    return null;
  }

  const { data, error } = await params.supabaseAdmin
    .from("orders")
    .select(
      "id, kind, status, payment_status, pickup_address, dropoff_address, restaurant_name, driver_id, client_user_id, client_id, user_id, created_by, restaurant_user_id, restaurant_id"
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const order = data as OrderRow;

  if (params.viewerRole === "client" && !clientOwnsOrder(order, params.userId)) {
    return null;
  }

  if (params.viewerRole === "driver" && String(order.driver_id ?? "") !== params.userId) {
    return null;
  }

  if (
    params.viewerRole === "restaurant" &&
    String(order.restaurant_user_id ?? order.restaurant_id ?? "") !== params.userId
  ) {
    return null;
  }

  const missionKind =
    order.kind === "food" || order.kind === "restaurant_order"
      ? "restaurant_order"
      : order.kind === "delivery"
        ? "delivery_request"
        : "unknown";

  const base: Omit<SharedMissionContext, "safeSummary"> = {
    missionId: order.id,
    missionKind,
    status: String(order.status ?? "unknown"),
    paymentStatus: order.payment_status ?? null,
    pickupAddress: order.pickup_address ?? null,
    dropoffAddress: order.dropoff_address ?? null,
    restaurantName: order.restaurant_name ?? null,
    driverAssigned: driverAssigned(order),
    viewerRole: params.viewerRole,
  };

  return {
    ...base,
    safeSummary: buildSafeSummary(base),
  };
}
