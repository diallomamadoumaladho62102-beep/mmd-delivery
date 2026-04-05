import { supabase } from "../lib/supabaseBrowser";

type SafeDirectStatus =
  | "pending"
  | "accepted"
  | "prepared"
  | "ready"
  | "canceled";

const FORBIDDEN_DIRECT_STATUSES = new Set(["dispatched", "delivered"]);

function normalizeStatus(status: string): string {
  return status.trim().toLowerCase();
}

export async function updateOrderStatus(
  orderId: string,
  newStatus: string,
  userId: string
) {
  const normalizedOrderId = orderId.trim();
  const normalizedStatus = normalizeStatus(newStatus);
  const normalizedUserId = userId.trim();

  if (!normalizedOrderId) {
    throw new Error("orderId is required.");
  }

  if (!normalizedStatus) {
    throw new Error("newStatus is required.");
  }

  if (!normalizedUserId) {
    throw new Error("userId is required.");
  }

  if (FORBIDDEN_DIRECT_STATUSES.has(normalizedStatus)) {
    throw new Error(
      `Direct status update forbidden for "${normalizedStatus}". Use the dedicated backend confirmation route instead.`
    );
  }

  const allowedDirectStatuses: SafeDirectStatus[] = [
    "pending",
    "accepted",
    "prepared",
    "ready",
    "canceled",
  ];

  if (!allowedDirectStatuses.includes(normalizedStatus as SafeDirectStatus)) {
    throw new Error(`Unsupported status "${normalizedStatus}".`);
  }

  const { data, error: selErr } = await supabase
    .from("orders")
    .select("status")
    .eq("id", normalizedOrderId)
    .single();

  if (selErr) {
    throw selErr;
  }

  const oldStatus =
    typeof data?.status === "string" ? normalizeStatus(data.status) : null;

  if (oldStatus === normalizedStatus) {
    return {
      ok: true,
      changed: false,
      orderId: normalizedOrderId,
      oldStatus,
      newStatus: normalizedStatus,
    };
  }

  const { error: updErr } = await supabase
    .from("orders")
    .update({ status: normalizedStatus })
    .eq("id", normalizedOrderId);

  if (updErr) {
    throw updErr;
  }

  return {
    ok: true,
    changed: true,
    orderId: normalizedOrderId,
    oldStatus,
    newStatus: normalizedStatus,
  };
}