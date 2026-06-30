type GenericRow = Record<string, unknown>;

export type DayKpiSnapshot = {
  ordersToday: number;
  ordersYesterday: number;
  revenueToday: number;
  revenueYesterday: number;
  customersToday: number;
  customersYesterday: number;
  averageBasket: number | null;
  averageBasketYesterday: number | null;
  revenueChangePct: number | null;
  ordersChangePct: number | null;
  customersChangePct: number | null;
  averageBasketChangePct: number | null;
};

export function isPaidFoodOrder(row: GenericRow): boolean {
  return String(row.payment_status ?? "").trim().toLowerCase() === "paid";
}

export function isCompletedOrderStatus(status: unknown): boolean {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized === "delivered" || normalized === "completed";
}

export function orderAmount(row: GenericRow): number {
  const total = Number(row.total);
  if (Number.isFinite(total) && total > 0) return total;
  const subtotal = Number(row.subtotal);
  const tax = Number(row.tax);
  const sum =
    (Number.isFinite(subtotal) ? subtotal : 0) + (Number.isFinite(tax) ? tax : 0);
  return Number.isFinite(sum) ? sum : 0;
}

export function clientIdFromOrder(row: GenericRow): string {
  return String(row.client_id ?? row.client_user_id ?? "").trim();
}

export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous <= 0) {
    if (current > 0) return 100;
    return null;
  }
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** KPI jour — règle unique : commandes food payées, revenu = livrées/terminées. */
export function computeDayKpiSnapshot(params: {
  todayRows: GenericRow[];
  yesterdayRows: GenericRow[];
}): DayKpiSnapshot {
  const todayPaid = params.todayRows.filter(isPaidFoodOrder);
  const yesterdayPaid = params.yesterdayRows.filter(isPaidFoodOrder);

  const todayCompletedPaid = todayPaid.filter((row) =>
    isCompletedOrderStatus(row.status)
  );
  const yesterdayCompletedPaid = yesterdayPaid.filter((row) =>
    isCompletedOrderStatus(row.status)
  );

  const revenueToday = todayCompletedPaid.reduce(
    (sum, row) => sum + orderAmount(row),
    0
  );
  const revenueYesterday = yesterdayCompletedPaid.reduce(
    (sum, row) => sum + orderAmount(row),
    0
  );

  const ordersToday = todayPaid.length;
  const ordersYesterday = yesterdayPaid.length;

  const customersToday = new Set(
    todayPaid.map(clientIdFromOrder).filter(Boolean)
  ).size;
  const customersYesterday = new Set(
    yesterdayPaid.map(clientIdFromOrder).filter(Boolean)
  ).size;

  const averageBasket =
    todayCompletedPaid.length > 0 ? revenueToday / todayCompletedPaid.length : null;
  const averageBasketYesterday =
    yesterdayCompletedPaid.length > 0
      ? revenueYesterday / yesterdayCompletedPaid.length
      : null;

  return {
    ordersToday,
    ordersYesterday,
    revenueToday,
    revenueYesterday,
    customersToday,
    customersYesterday,
    averageBasket,
    averageBasketYesterday,
    revenueChangePct: pctChange(revenueToday, revenueYesterday),
    ordersChangePct: pctChange(ordersToday, ordersYesterday),
    customersChangePct: pctChange(customersToday, customersYesterday),
    averageBasketChangePct:
      averageBasket != null && averageBasketYesterday != null
        ? pctChange(averageBasket, averageBasketYesterday)
        : null,
  };
}
