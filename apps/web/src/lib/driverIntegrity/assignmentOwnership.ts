import type { SupabaseClient } from "@supabase/supabase-js";
import type { DriverIntegrityEntityType } from "./types";

export type AssignedEntityRow = {
  id: string;
  driverId: string | null;
  driverAcceptedAt: string | null;
  status: string;
  pickedUp: boolean;
  delivered: boolean;
  cancelled: boolean;
};

function tableFor(entityType: DriverIntegrityEntityType): string {
  if (entityType === "delivery_request") return "delivery_requests";
  if (entityType === "marketplace_job") return "marketplace_delivery_jobs";
  return "orders";
}

export function sourceTableForEntity(
  entityType: DriverIntegrityEntityType
): "orders" | "delivery_requests" | "marketplace_delivery_jobs" {
  if (entityType === "delivery_request") return "delivery_requests";
  if (entityType === "marketplace_job") return "marketplace_delivery_jobs";
  return "orders";
}

export async function loadAssignedEntity(
  supabase: SupabaseClient,
  entityType: DriverIntegrityEntityType,
  entityId: string
): Promise<AssignedEntityRow | null> {
  const table = tableFor(entityType);
  const columns =
    entityType === "marketplace_job"
      ? "id,assigned_driver_id,driver_accepted_at,status"
      : "id,driver_id,driver_accepted_at,status,picked_up_at,delivered_at,cancelled_at";

  const { data } = await supabase
    .from(table)
    .select(columns)
    .eq("id", entityId)
    .maybeSingle();
  if (!data) return null;

  const row = data as unknown as Record<string, unknown>;
  const status = String(row.status ?? "").toLowerCase();
  if (entityType === "marketplace_job") {
    return {
      id: String(row.id),
      driverId: row.assigned_driver_id ? String(row.assigned_driver_id) : null,
      driverAcceptedAt: row.driver_accepted_at
        ? String(row.driver_accepted_at)
        : null,
      status,
      pickedUp: status === "picked_up" || status === "delivered",
      delivered: status === "delivered",
      cancelled: status === "cancelled" || status === "canceled",
    };
  }

  return {
    id: String(row.id),
    driverId: row.driver_id ? String(row.driver_id) : null,
    driverAcceptedAt: row.driver_accepted_at
      ? String(row.driver_accepted_at)
      : null,
    status,
    pickedUp: Boolean(row.picked_up_at) || status === "picked_up",
    delivered: Boolean(row.delivered_at) || status === "delivered",
    cancelled:
      Boolean(row.cancelled_at) ||
      status === "cancelled" ||
      status === "canceled",
  };
}

export function driverOwnsAssignment(
  assigned: AssignedEntityRow,
  driverId: string
): boolean {
  return String(assigned.driverId ?? "") === driverId;
}

export function isUniqueViolation(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "23505" || /duplicate|unique|23505/i.test(String(error.message ?? ""))
  );
}
