import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiRole, SharedMissionContext } from "@/lib/ai/aiTypes";
import { explainOrderStatus } from "@/lib/ai/tools/shared/explainOrderStatus";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export type BuildSharedMissionContextInput = {
  supabaseAdmin: SupabaseClient;
  userId: string;
  viewerRole: AiRole;
  orderId: string;
};

function clientOwnsRow(userId: string, row: Record<string, unknown>): boolean {
  const ids = [
    row.client_user_id,
    row.client_id,
    row.created_by,
    row.user_id,
  ].map((v) => String(v ?? "").trim());
  return ids.includes(userId);
}

function summarize(params: {
  kind: SharedMissionContext["missionKind"];
  status: string;
  pickup: string | null;
  dropoff: string | null;
  restaurantName: string | null;
  driverAssigned: boolean;
  paymentStatus: string | null;
}): string {
  const parts = [
    params.kind.replace("_", " "),
    `status ${params.status}`,
  ];
  if (params.restaurantName) parts.push(`restaurant ${params.restaurantName}`);
  if (params.pickup) parts.push(`from ${params.pickup}`);
  if (params.dropoff) parts.push(`to ${params.dropoff}`);
  if (params.driverAssigned) parts.push("driver assigned");
  if (params.paymentStatus) parts.push(`payment ${params.paymentStatus}`);
  parts.push(explainOrderStatus(params.status));
  return parts.join(" · ");
}

export async function buildSharedMissionContext(
  input: BuildSharedMissionContextInput
): Promise<SharedMissionContext | null> {
  const orderId = String(input.orderId ?? "").trim();
  if (!UUID_RE.test(orderId)) return null;

  const { data: order } = await input.supabaseAdmin
    .from("orders")
    .select(
      "id, kind, status, payment_status, pickup_address, dropoff_address, restaurant_name, driver_id, client_user_id, client_id, created_by, user_id"
    )
    .eq("id", orderId)
    .maybeSingle();

  if (order && clientOwnsRow(input.userId, order as Record<string, unknown>)) {
    const pickup = String(order.pickup_address ?? "").trim() || null;
    const dropoff = String(order.dropoff_address ?? "").trim() || null;
    const restaurantName = String(order.restaurant_name ?? "").trim() || null;
    const driverAssigned = Boolean(order.driver_id);
    const kind: SharedMissionContext["missionKind"] =
      String(order.kind ?? "") === "food" || restaurantName
        ? "restaurant_order"
        : "unknown";
    return {
      missionId: String(order.id),
      missionKind: kind,
      status: String(order.status ?? "unknown"),
      paymentStatus: order.payment_status != null ? String(order.payment_status) : null,
      pickupAddress: pickup,
      dropoffAddress: dropoff,
      restaurantName,
      driverAssigned,
      viewerRole: input.viewerRole,
      safeSummary: summarize({
        kind,
        status: String(order.status ?? "unknown"),
        pickup,
        dropoff,
        restaurantName,
        driverAssigned,
        paymentStatus: order.payment_status != null ? String(order.payment_status) : null,
      }),
    };
  }

  const { data: delivery } = await input.supabaseAdmin
    .from("delivery_requests")
    .select(
      "id, status, payment_status, pickup_address, dropoff_address, driver_id, client_user_id"
    )
    .eq("id", orderId)
    .maybeSingle();

  if (
    delivery &&
    clientOwnsRow(input.userId, delivery as Record<string, unknown>)
  ) {
    const pickup = String(delivery.pickup_address ?? "").trim() || null;
    const dropoff = String(delivery.dropoff_address ?? "").trim() || null;
    const driverAssigned = Boolean(delivery.driver_id);
    return {
      missionId: String(delivery.id),
      missionKind: "delivery_request",
      status: String(delivery.status ?? "unknown"),
      paymentStatus:
        delivery.payment_status != null ? String(delivery.payment_status) : null,
      pickupAddress: pickup,
      dropoffAddress: dropoff,
      restaurantName: null,
      driverAssigned,
      viewerRole: input.viewerRole,
      safeSummary: summarize({
        kind: "delivery_request",
        status: String(delivery.status ?? "unknown"),
        pickup,
        dropoff,
        restaurantName: null,
        driverAssigned,
        paymentStatus:
          delivery.payment_status != null ? String(delivery.payment_status) : null,
      }),
    };
  }

  const { data: ride } = await input.supabaseAdmin
    .from("taxi_rides")
    .select(
      "id, status, payment_status, pickup_address, dropoff_address, driver_id, client_user_id"
    )
    .eq("id", orderId)
    .maybeSingle();

  if (ride && clientOwnsRow(input.userId, ride as Record<string, unknown>)) {
    const pickup = String(ride.pickup_address ?? "").trim() || null;
    const dropoff = String(ride.dropoff_address ?? "").trim() || null;
    const driverAssigned = Boolean(ride.driver_id);
    return {
      missionId: String(ride.id),
      missionKind: "taxi_ride",
      status: String(ride.status ?? "unknown"),
      paymentStatus: ride.payment_status != null ? String(ride.payment_status) : null,
      pickupAddress: pickup,
      dropoffAddress: dropoff,
      restaurantName: null,
      driverAssigned,
      viewerRole: input.viewerRole,
      safeSummary: summarize({
        kind: "taxi_ride",
        status: String(ride.status ?? "unknown"),
        pickup,
        dropoff,
        restaurantName: null,
        driverAssigned,
        paymentStatus: ride.payment_status != null ? String(ride.payment_status) : null,
      }),
    };
  }

  return null;
}
