/**
 * Pure hero + week-chart aggregation for Driver Earnings.
 * Food/delivery amounts are dollars; taxi chart points are cents.
 */

export type FoodEarningsRow = {
  created_at: string | null;
  baseDollars: number;
  tipDollars: number;
};

export type TaxiChartPoint = {
  completedAt: string;
  driverCents: number;
};

export type HeroTotalsInput = {
  foodRows: FoodEarningsRow[];
  taxiDriverCents: number;
  taxiTrips: number;
};

export function foldHeroTotals(input: HeroTotalsInput) {
  const foodTrips = input.foodRows.length;
  const foodBase = input.foodRows.reduce((sum, o) => sum + o.baseDollars, 0);
  const tips = input.foodRows.reduce((sum, o) => sum + o.tipDollars, 0);
  const taxiDollars = Number.isFinite(input.taxiDriverCents)
    ? input.taxiDriverCents / 100
    : 0;
  const trips = foodTrips + (Number.isFinite(input.taxiTrips) ? input.taxiTrips : 0);
  const baseEarnings = foodBase + taxiDollars;
  const totalEarnings = baseEarnings + tips;
  const averageTrip = trips > 0 ? totalEarnings / trips : 0;
  return {
    trips,
    baseEarnings,
    tips,
    totalEarnings,
    points: trips,
    averageTrip,
  };
}

const DEFAULT_DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Buckets food (created_at) + taxi (completed_at) into Mon–Sun dollar bars. */
export function foldWeekBars(
  foodRows: FoodEarningsRow[],
  taxiPoints: TaxiChartPoint[],
  dayLabels: readonly string[] = DEFAULT_DAY_LABELS,
) {
  const map: Record<string, number> = {};
  for (const d of dayLabels) map[d] = 0;

  const bump = (iso: string | null | undefined, dollars: number) => {
    if (!iso || !Number.isFinite(dollars) || dollars === 0) return;
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return;
    const js = d.getDay();
    const idx = js === 0 ? 6 : js - 1;
    const key = dayLabels[idx];
    if (!key) return;
    map[key] += dollars;
  };

  for (const o of foodRows) {
    bump(o.created_at, o.baseDollars + o.tipDollars);
  }
  for (const p of taxiPoints) {
    bump(p.completedAt, (Number(p.driverCents) || 0) / 100);
  }

  const max = Math.max(1, ...Object.values(map));
  return dayLabels.map((label) => ({
    label,
    value: map[label] ?? 0,
    h: Math.max(10, Math.round(((map[label] ?? 0) / max) * 70)),
  }));
}
