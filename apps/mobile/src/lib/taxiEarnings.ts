import { supabase } from "./supabase";
import { applyLiveTripFilters } from "./tripVisibility";

export type TaxiEarningsByCurrency = {
  currency: string;
  completedRides: number;
  totalDriverCents: number;
  pendingPayoutCents: number;
  paidPayoutCents: number;
};

/** One completed ride for hero chart bucketing (Mon–Sun). */
export type TaxiEarningsChartPoint = {
  completedAt: string;
  driverCents: number;
};

export type TaxiEarningsSummary = {
  completedRides: number;
  totalDriverCents: number;
  pendingPayoutCents: number;
  paidPayoutCents: number;
  currency: string;
  byCurrency: TaxiEarningsByCurrency[];
  /** Per-ride points for the week chart (same range as totals). */
  chartPoints: TaxiEarningsChartPoint[];
};

export type LoadTaxiDriverEarningsOptions = {
  /** Inclusive lower bound (ISO). Filters on completed_at, falling back to created_at. */
  fromISO?: string | null;
  /** Inclusive upper bound (ISO). */
  toISO?: string | null;
};

function emptyBucket(currency: string): TaxiEarningsByCurrency {
  return {
    currency,
    completedRides: 0,
    totalDriverCents: 0,
    pendingPayoutCents: 0,
    paidPayoutCents: 0,
  };
}

function rideInRange(
  row: { completed_at?: string | null; created_at?: string | null },
  fromISO?: string | null,
  toISO?: string | null,
): boolean {
  if (!fromISO && !toISO) return true;
  const stamp = String(row.completed_at ?? row.created_at ?? "").trim();
  if (!stamp) return false;
  const t = new Date(stamp).getTime();
  if (!Number.isFinite(t)) return false;
  if (fromISO) {
    const from = new Date(fromISO).getTime();
    if (Number.isFinite(from) && t < from) return false;
  }
  if (toISO) {
    const to = new Date(toISO).getTime();
    if (Number.isFinite(to) && t > to) return false;
  }
  return true;
}

/**
 * Aggregates completed taxi rides and commission payout state for the signed-in driver.
 *
 * Financial SoT:
 * - Display amount: taxi_rides.driver_payout_cents (fallback) / taxi_commissions.driver_cents
 * - Paid vs pending: Stripe Connect Transfer id on taxi_commissions.driver_transfer_id
 *   (NOT bank payouts — those are Sunday Connect→bank cron)
 */
export async function loadTaxiDriverEarnings(
  driverId: string,
  options?: LoadTaxiDriverEarningsOptions,
): Promise<TaxiEarningsSummary> {
  const fromISO = options?.fromISO ?? null;
  const toISO = options?.toISO ?? null;

  const { data: rides, error: ridesErr } = await applyLiveTripFilters(
    supabase
      .from("taxi_rides")
      .select("id, driver_payout_cents, currency, status, completed_at, created_at"),
  )
    .eq("driver_id", driverId)
    .eq("status", "completed");

  if (ridesErr) {
    throw new Error(ridesErr.message);
  }

  const rangedRides = (rides ?? []).filter((row) =>
    rideInRange(row, fromISO, toISO),
  );

  const rideIds = rangedRides.map((row) => row.id);
  let commissions: Array<{
    driver_cents: number | null;
    currency: string | null;
    driver_paid_out: boolean | null;
    driver_transfer_id: string | null;
    taxi_ride_id: string;
  }> = [];

  if (rideIds.length > 0) {
    const { data, error: comErr } = await supabase
      .from("taxi_commissions")
      .select(
        "driver_cents, currency, driver_paid_out, driver_transfer_id, taxi_ride_id",
      )
      .in("taxi_ride_id", rideIds);

    if (comErr) {
      throw new Error(comErr.message);
    }

    commissions = data ?? [];
  }

  const byCurrencyMap = new Map<string, TaxiEarningsByCurrency>();
  const commissionByRide = new Map(commissions.map((c) => [c.taxi_ride_id, c]));
  const chartPoints: TaxiEarningsChartPoint[] = [];

  for (const row of rangedRides) {
    const currency = String(row.currency ?? "USD").toUpperCase();
    const bucket = byCurrencyMap.get(currency) ?? emptyBucket(currency);
    bucket.completedRides += 1;

    const cents = Number(row.driver_payout_cents ?? 0);
    bucket.totalDriverCents += cents;

    const stamp = String(row.completed_at ?? row.created_at ?? "").trim();
    if (stamp && Number.isFinite(cents) && cents > 0) {
      chartPoints.push({ completedAt: stamp, driverCents: cents });
    }

    const commission = commissionByRide.get(row.id);
    const driverCents = Number(commission?.driver_cents ?? cents);
    // Stripe Connect SoT: paid only when Transfer id exists.
    const transferred = Boolean(String(commission?.driver_transfer_id ?? "").trim());

    if (transferred) {
      bucket.paidPayoutCents += driverCents;
    } else {
      bucket.pendingPayoutCents += driverCents;
    }

    byCurrencyMap.set(currency, bucket);
  }

  const byCurrency = Array.from(byCurrencyMap.values()).sort((a, b) =>
    a.currency.localeCompare(b.currency)
  );

  const primary = byCurrency[0] ?? emptyBucket("USD");

  return {
    completedRides: rangedRides.length,
    totalDriverCents: byCurrency.reduce((s, b) => s + b.totalDriverCents, 0),
    pendingPayoutCents: byCurrency.reduce((s, b) => s + b.pendingPayoutCents, 0),
    paidPayoutCents: byCurrency.reduce((s, b) => s + b.paidPayoutCents, 0),
    currency: primary.currency,
    byCurrency,
    chartPoints,
  };
}

/** Exported for unit tests — date window membership. */
export function taxiRideInEarningsRange(
  row: { completed_at?: string | null; created_at?: string | null },
  fromISO?: string | null,
  toISO?: string | null,
): boolean {
  return rideInRange(row, fromISO, toISO);
}
