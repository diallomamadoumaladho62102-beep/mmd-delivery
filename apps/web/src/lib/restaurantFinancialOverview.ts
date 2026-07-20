import {
  computeRestaurantTotalsFromOrders,
  getRestaurantCommissionRate,
  getRestaurantTaxSummary,
} from "@/lib/restaurantTax";
import { applyLiveTripFilters } from "@/lib/tripVisibility";

type GenericRow = Record<string, unknown>;

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isRestaurantOrderForUser(row: GenericRow, restaurantUserId: string): boolean {
  const keys = [
    "restaurant_id",
    "restaurant_user_id",
    "vendor_id",
    "merchant_id",
    "seller_id",
  ] as const;

  return keys.some((key) => {
    const value = row[key];
    return typeof value === "string" && value === restaurantUserId;
  });
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type RestaurantFinancialOverviewData = {
  currency: string;
  grossSales: number;
  platformCommission: number;
  netRevenue: number;
  totalOrders: number;
  pendingPayout: number;
  lastPayoutAmount: number | null;
  lastPayoutDate: string | null;
  profileComplete: boolean;
  missingFields: string[];
  chart: { label: string; gross: number; net: number }[];
  recentStatements: [];
  recentPayouts: {
    id: string;
    amount: number;
    status: string;
    date: string;
  }[];
};

export async function getRestaurantFinancialOverview(params: {
  supabase: Parameters<typeof getRestaurantTaxSummary>[0]["supabase"];
  restaurantUserId: string;
}): Promise<RestaurantFinancialOverviewData> {
  const { supabase, restaurantUserId } = params;
  const year = new Date().getUTCFullYear();

  const yearlySummary = await getRestaurantTaxSummary({
    supabase,
    restaurantUserId,
    year,
    range: "yearly",
  });

  const profile = yearlySummary.profile;
  const totals = yearlySummary.totals;

  const chartStart = startOfUtcDay(new Date());
  chartStart.setUTCDate(chartStart.getUTCDate() - 6);

  const { data: recentOrders, error: ordersError } = await applyLiveTripFilters(
    supabase
      .from("orders")
      .select(
        "id, created_at, status, payment_status, restaurant_id, restaurant_user_id, subtotal, total, restaurant_net_amount, currency"
      ),
  )
    .gte("created_at", chartStart.toISOString())
    .eq("payment_status", "paid");

  if (ordersError) {
    throw new Error(ordersError.message || "Failed to load restaurant orders");
  }

  const orderRows = (Array.isArray(recentOrders) ? recentOrders : []) as GenericRow[];
  const commissionRate = await getRestaurantCommissionRate(supabase);
  const todayStart = startOfUtcDay(new Date());
  const chart: { label: string; gross: number; net: number }[] = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    const dayStart = new Date(todayStart);
    dayStart.setUTCDate(dayStart.getUTCDate() - offset);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const dayRows = orderRows.filter((row) => {
      if (!isRestaurantOrderForUser(row, restaurantUserId)) return false;
      const created = String(row.created_at ?? "");
      if (!created) return false;
      const ms = new Date(created).getTime();
      return ms >= dayStart.getTime() && ms < dayEnd.getTime();
    });

    const dayTotals = computeRestaurantTotalsFromOrders({
      rows: dayRows,
      restaurantUserId,
      year: dayStart.getUTCFullYear(),
      range: "yearly",
      commissionRate,
    });

    chart.push({
      label: WEEKDAY_LABELS[dayStart.getUTCDay()],
      gross: dayTotals.grossSales,
      net: dayTotals.restaurantNet,
    });
  }

  const { data: payoutRows, error: payoutError } = await applyLiveTripFilters(
    supabase
      .from("orders")
      .select(
        "id, restaurant_net_amount, restaurant_paid_out_at, restaurant_id, restaurant_user_id"
      ),
  )
    .eq("payment_status", "paid")
    .eq("restaurant_paid_out", true)
    .order("restaurant_paid_out_at", { ascending: false })
    .limit(10);

  if (payoutError) {
    throw new Error(payoutError.message || "Failed to load payout history");
  }

  const { data: pendingRows, error: pendingError } = await applyLiveTripFilters(
    supabase
      .from("orders")
      .select(
        "id, restaurant_net_amount, restaurant_paid_out, restaurant_id, restaurant_user_id"
      ),
  )
    .eq("payment_status", "paid")
    .or("restaurant_paid_out.is.null,restaurant_paid_out.eq.false")
    .in("status", ["delivered", "completed"]);

  if (pendingError) {
    throw new Error(pendingError.message || "Failed to load pending payouts");
  }

  let pendingPayout = 0;

  for (const row of (pendingRows ?? []) as GenericRow[]) {
    if (!isRestaurantOrderForUser(row, restaurantUserId)) continue;
    const net = asNumber(row.restaurant_net_amount);
    pendingPayout += net > 0 ? net : 0;
  }

  pendingPayout = roundMoney(pendingPayout);

  const recentPayouts = ((payoutRows ?? []) as GenericRow[])
    .filter((row) => isRestaurantOrderForUser(row, restaurantUserId))
    .map((row) => ({
      id: String(row.id ?? ""),
      amount: roundMoney(asNumber(row.restaurant_net_amount)),
      status: "paid",
      date: String(row.restaurant_paid_out_at ?? "").slice(0, 10) || "",
    }))
    .filter((row) => row.id);

  const lastPayout = recentPayouts[0] ?? null;

  return {
    currency: "USD",
    grossSales: totals.grossSales,
    platformCommission: totals.platformCommission,
    netRevenue: totals.restaurantNet,
    totalOrders: totals.totalOrders,
    pendingPayout,
    lastPayoutAmount: lastPayout?.amount ?? null,
    lastPayoutDate: lastPayout?.date ?? null,
    profileComplete: profile.isComplete,
    missingFields: profile.missingFields,
    chart,
    recentStatements: [],
    recentPayouts,
  };
}
