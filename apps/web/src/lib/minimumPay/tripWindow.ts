export type TripSourceRow = {
  driverAcceptedAt: string | null;
  restaurantAcceptedAt?: string | null;
  createdAt?: string | null;
  preparingAt?: string | null;
  readyAt?: string | null;
  deliveredAt?: string | null;
  deliveredConfirmedAt?: string | null;
  cancelledAt?: string | null;
  status?: string | null;
};

export type TripWindow = {
  startedAt: string;
  endedAt: string | null;
  endReason: "completed" | "cancelled" | null;
};

/**
 * Trip time starts at DRIVER ACCEPTED only.
 * Restaurant accepted / preparing / ready / order created are never the start.
 */
export function resolveTripWindow(row: TripSourceRow): TripWindow | null {
  if (!row.driverAcceptedAt) return null;
  const startedAt = row.driverAcceptedAt;

  if (row.deliveredAt || row.deliveredConfirmedAt) {
    return {
      startedAt,
      endedAt: row.deliveredAt ?? row.deliveredConfirmedAt ?? null,
      endReason: "completed",
    };
  }

  const status = String(row.status ?? "").toLowerCase();
  if (row.cancelledAt || status === "canceled" || status === "cancelled") {
    return {
      startedAt,
      endedAt: row.cancelledAt ?? null,
      endReason: "cancelled",
    };
  }

  return { startedAt, endedAt: null, endReason: null };
}

export function restaurantPrepBeforeAcceptIsExcluded(row: TripSourceRow): boolean {
  const window = resolveTripWindow(row);
  if (!window) return true;
  const start = Date.parse(window.startedAt);
  for (const stamp of [row.createdAt, row.restaurantAcceptedAt, row.preparingAt, row.readyAt]) {
    if (!stamp) continue;
    const at = Date.parse(stamp);
    if (Number.isFinite(at) && Number.isFinite(start) && at < start) {
      return true;
    }
  }
  return true;
}
