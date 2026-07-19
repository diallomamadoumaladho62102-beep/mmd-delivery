/** Pure helpers for global restaurant new-order alerting (no RN imports). */

export type RestaurantAlertOrder = {
  id: string;
  status?: string | null;
  payment_status?: string | null;
  kind?: string | null;
  restaurant_accept_expires_at?: string | null;
  created_at?: string | null;
};

const DEFAULT_ACCEPT_WINDOW_MS = 10 * 60 * 1000;

export function remainingAcceptSeconds(
  expiresAt: string | null | undefined,
  createdAt: string | null | undefined,
  nowMs = Date.now(),
): number {
  const expiresMs = expiresAt ? Date.parse(String(expiresAt)) : NaN;
  if (Number.isFinite(expiresMs)) {
    return Math.max(0, Math.floor((expiresMs - nowMs) / 1000));
  }
  const createdMs = createdAt ? Date.parse(String(createdAt)) : NaN;
  if (!Number.isFinite(createdMs)) return DEFAULT_ACCEPT_WINDOW_MS / 1000;
  const end = createdMs + DEFAULT_ACCEPT_WINDOW_MS;
  return Math.max(0, Math.floor((end - nowMs) / 1000));
}

export function isPaidPendingFoodOrder(
  order: RestaurantAlertOrder,
  nowMs = Date.now(),
): boolean {
  const kind = String(order.kind ?? "food").toLowerCase();
  if (kind !== "food") return false;
  const payment = String(order.payment_status ?? "paid").toLowerCase();
  if (payment && payment !== "paid") return false;
  const status = String(order.status ?? "").toLowerCase();
  if (status !== "pending") return false;
  return remainingAcceptSeconds(
    order.restaurant_accept_expires_at,
    order.created_at,
    nowMs,
  ) > 0;
}

/**
 * Idempotent announcement planner:
 * - shouldRing if any valid pending paid food order exists
 * - newlyAnnouncedIds = valid pending ids not yet in announcedOrderIds
 */
export function planRestaurantOrderAlert(input: {
  orders: RestaurantAlertOrder[];
  announcedOrderIds: Iterable<string>;
  nowMs?: number;
}): {
  shouldRing: boolean;
  activePendingIds: string[];
  newlyAnnouncedIds: string[];
} {
  const nowMs = input.nowMs ?? Date.now();
  const announced = new Set(
    [...input.announcedOrderIds].map((id) => String(id).trim()).filter(Boolean),
  );
  const activePendingIds = (input.orders ?? [])
    .filter((o) => isPaidPendingFoodOrder(o, nowMs))
    .map((o) => String(o.id).trim())
    .filter(Boolean);

  const newlyAnnouncedIds = activePendingIds.filter((id) => !announced.has(id));
  return {
    shouldRing: activePendingIds.length > 0,
    activePendingIds,
    newlyAnnouncedIds,
  };
}

export function restaurantNewOrderDedupKey(orderId: string): string {
  return `restaurant_new_order:${String(orderId).trim()}`;
}
