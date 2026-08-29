import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FinancialActorRole,
  FinancialEntityType,
  FinancialTimelineEvent,
} from "@/lib/finance/financialTimelineTypes";

export type TimelineAccessOk = { ok: true; role: FinancialActorRole };
export type TimelineAccessDenied = {
  ok: false;
  status: 403 | 404;
  error: "Forbidden" | "Not found";
};
export type TimelineAccessResult = TimelineAccessOk | TimelineAccessDenied;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isFinancialEntityId(value: string): boolean {
  return UUID_RE.test(String(value ?? "").trim());
}

function idsEqual(left: unknown, right: string): boolean {
  return String(left ?? "").trim() === right;
}

export function resolveWalletTimelineAccess(
  userId: string,
  entityId: string
): TimelineAccessResult {
  if (!isFinancialEntityId(entityId) || !idsEqual(entityId, userId)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true, role: "client" };
}

export function resolveOrderTimelineRole(
  userId: string,
  order: {
    client_user_id?: string | null;
    user_id?: string | null;
    restaurant_user_id?: string | null;
    driver_id?: string | null;
  } | null
): TimelineAccessResult {
  if (!order) return { ok: false, status: 404, error: "Not found" };
  if (idsEqual(order.client_user_id, userId) || idsEqual(order.user_id, userId)) {
    return { ok: true, role: "client" };
  }
  if (idsEqual(order.restaurant_user_id, userId)) {
    return { ok: true, role: "restaurant" };
  }
  if (idsEqual(order.driver_id, userId)) {
    return { ok: true, role: "driver" };
  }
  return { ok: false, status: 403, error: "Forbidden" };
}

export function resolveDeliveryRequestTimelineRole(
  userId: string,
  request: {
    client_user_id?: string | null;
    created_by?: string | null;
    driver_id?: string | null;
  } | null
): TimelineAccessResult {
  if (!request) return { ok: false, status: 404, error: "Not found" };
  if (
    idsEqual(request.client_user_id, userId) ||
    idsEqual(request.created_by, userId)
  ) {
    return { ok: true, role: "client" };
  }
  if (idsEqual(request.driver_id, userId)) {
    return { ok: true, role: "driver" };
  }
  return { ok: false, status: 403, error: "Forbidden" };
}

export function redactFinancialEventReferences(
  events: FinancialTimelineEvent[],
  role: FinancialActorRole
): FinancialTimelineEvent[] {
  if (role === "admin") return events;
  return events.map((event) => ({ ...event, references: undefined }));
}

/**
 * Server-side ownership for GET /api/finance/timeline.
 * Admin may view any entity. Everyone else must be a participant.
 */
export async function resolveFinancialTimelineAccess(params: {
  supabaseAdmin: SupabaseClient;
  userId: string;
  entityType: FinancialEntityType;
  entityId: string;
  isAdmin: boolean;
}): Promise<TimelineAccessResult> {
  const { supabaseAdmin, userId, entityType, entityId, isAdmin } = params;

  if (!isFinancialEntityId(entityId)) {
    return { ok: false, status: 404, error: "Not found" };
  }

  if (isAdmin) {
    return { ok: true, role: "admin" };
  }

  if (entityType === "wallet") {
    return resolveWalletTimelineAccess(userId, entityId);
  }

  if (entityType === "taxi_ride") {
    const { data: ride } = await supabaseAdmin
      .from("taxi_rides")
      .select("client_user_id, driver_id")
      .eq("id", entityId)
      .maybeSingle();
    if (!ride) return { ok: false, status: 404, error: "Not found" };
    if (idsEqual(ride.client_user_id, userId)) {
      return { ok: true, role: "client" };
    }
    if (idsEqual(ride.driver_id, userId)) {
      return { ok: true, role: "driver" };
    }
    return { ok: false, status: 403, error: "Forbidden" };
  }

  if (entityType === "business_account") {
    const { data: member } = await supabaseAdmin
      .from("taxi_business_members")
      .select("id")
      .eq("business_account_id", entityId)
      .eq("user_id", userId)
      .eq("active", true)
      .maybeSingle();
    if (!member) return { ok: false, status: 403, error: "Forbidden" };
    return { ok: true, role: "business" };
  }

  if (entityType === "seller_order") {
    const { data: order } = await supabaseAdmin
      .from("seller_orders")
      .select("client_user_id, seller_id")
      .eq("id", entityId)
      .maybeSingle();
    if (!order) return { ok: false, status: 404, error: "Not found" };
    if (idsEqual(order.client_user_id, userId)) {
      return { ok: true, role: "client" };
    }
    const { data: seller } = await supabaseAdmin
      .from("sellers")
      .select("id")
      .eq("id", order.seller_id)
      .or(`user_id.eq.${userId},owner_user_id.eq.${userId}`)
      .maybeSingle();
    if (!seller) return { ok: false, status: 403, error: "Forbidden" };
    return { ok: true, role: "seller" };
  }

  if (entityType === "order") {
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("client_user_id, user_id, restaurant_user_id, driver_id")
      .eq("id", entityId)
      .maybeSingle();
    return resolveOrderTimelineRole(userId, order);
  }

  if (entityType === "delivery_request") {
    const { data: request } = await supabaseAdmin
      .from("delivery_requests")
      .select("client_user_id, created_by, driver_id")
      .eq("id", entityId)
      .maybeSingle();
    return resolveDeliveryRequestTimelineRole(userId, request);
  }

  return { ok: false, status: 403, error: "Forbidden" };
}
