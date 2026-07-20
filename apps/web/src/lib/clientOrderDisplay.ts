/**
 * Client home / order-list display rules (pure, unit-tested).
 * Keep in sync with apps/mobile/src/lib/clientOrderDisplay.ts
 */

export const CLIENT_ACTIVE_STATUSES = new Set([
  "pending",
  "paid",
  "searching",
  "assigned",
  "accepted",
  "preparing",
  "prepared",
  "ready",
  "dispatched",
  "picked_up",
  "driver_arriving",
  "arrived",
  "driver_arrived",
  "in_progress",
  "waiting",
  "out_for_delivery",
  "in_transit",
  "dispatching",
  "queued",
]);

export const CLIENT_COMPLETED_STATUSES = new Set([
  "delivered",
  "completed",
]);

export const CLIENT_CANCELLED_STATUSES = new Set([
  "canceled",
  "cancelled",
  "refunded",
]);

export type ClientTripKind =
  | "restaurant_order"
  | "delivery_request"
  | "taxi_ride";

export type ClientTripLike = {
  id: string;
  kind: ClientTripKind;
  status: string;
  payment_status?: string | null;
  created_at?: string | null;
  is_test?: boolean | null;
  hidden_from_user?: boolean | null;
  archived_at?: string | null;
};

export function isVisibleClientTrip(item: ClientTripLike): boolean {
  if (item.is_test === true) return false;
  if (item.hidden_from_user === true) return false;
  if (item.archived_at) return false;
  return true;
}

export function normalizeStatus(status: string): string {
  return String(status || "").trim().toLowerCase();
}

export function isClientActiveStatus(status: string): boolean {
  const s = normalizeStatus(status);
  if (CLIENT_COMPLETED_STATUSES.has(s) || CLIENT_CANCELLED_STATUSES.has(s)) {
    return false;
  }
  return CLIENT_ACTIVE_STATUSES.has(s);
}

export function isClientCompletedStatus(status: string): boolean {
  return CLIENT_COMPLETED_STATUSES.has(normalizeStatus(status));
}

export function isClientCancelledStatus(status: string): boolean {
  return CLIENT_CANCELLED_STATUSES.has(normalizeStatus(status));
}

export function computeClientOrderStats(items: ClientTripLike[]) {
  const visible = items.filter(isVisibleClientTrip);
  return {
    totalOrders: visible.length,
    active: visible.filter((i) => isClientActiveStatus(i.status)).length,
    completed: visible.filter((i) => isClientCompletedStatus(i.status)).length,
    cancelled: visible.filter((i) => isClientCancelledStatus(i.status)).length,
  };
}

/**
 * A) If any active → show all actives.
 * B) Else → show only the latest completed in the main zone.
 * Full history remains behind a dedicated button/screen.
 */
export function selectClientHomeDisplayItems<T extends ClientTripLike>(
  items: T[],
): { displayItems: T[]; mode: "active" | "last_completed" | "empty" } {
  const visible = items
    .filter(isVisibleClientTrip)
    .slice()
    .sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });

  const actives = visible.filter((i) => isClientActiveStatus(i.status));
  if (actives.length > 0) {
    return { displayItems: actives, mode: "active" };
  }

  const completed = visible.filter((i) => isClientCompletedStatus(i.status));
  if (completed.length > 0) {
    return { displayItems: [completed[0]], mode: "last_completed" };
  }

  return { displayItems: [], mode: "empty" };
}
