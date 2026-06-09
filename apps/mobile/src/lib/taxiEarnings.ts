import { supabase } from "./supabase";

export type TaxiEarningsByCurrency = {
  currency: string;
  completedRides: number;
  totalDriverCents: number;
  pendingPayoutCents: number;
  paidPayoutCents: number;
};

export type TaxiEarningsSummary = {
  completedRides: number;
  totalDriverCents: number;
  pendingPayoutCents: number;
  paidPayoutCents: number;
  currency: string;
  byCurrency: TaxiEarningsByCurrency[];
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

/** Aggregates completed taxi rides and commission payout state for the signed-in driver. */
export async function loadTaxiDriverEarnings(
  driverId: string
): Promise<TaxiEarningsSummary> {
  const { data: rides, error: ridesErr } = await supabase
    .from("taxi_rides")
    .select("id, driver_payout_cents, currency, status")
    .eq("driver_id", driverId)
    .eq("status", "completed");

  if (ridesErr) {
    throw new Error(ridesErr.message);
  }

  const rideIds = (rides ?? []).map((row) => row.id);
  let commissions: Array<{
    driver_cents: number | null;
    currency: string | null;
    driver_paid_out: boolean | null;
    taxi_ride_id: string;
  }> = [];

  if (rideIds.length > 0) {
    const { data, error: comErr } = await supabase
      .from("taxi_commissions")
      .select("driver_cents, currency, driver_paid_out, taxi_ride_id")
      .in("taxi_ride_id", rideIds);

    if (comErr) {
      throw new Error(comErr.message);
    }

    commissions = data ?? [];
  }

  const byCurrencyMap = new Map<string, TaxiEarningsByCurrency>();
  const commissionByRide = new Map(commissions.map((c) => [c.taxi_ride_id, c]));

  for (const row of rides ?? []) {
    const currency = String(row.currency ?? "USD").toUpperCase();
    const bucket = byCurrencyMap.get(currency) ?? emptyBucket(currency);
    bucket.completedRides += 1;

    const cents = Number(row.driver_payout_cents ?? 0);
    bucket.totalDriverCents += cents;

    const commission = commissionByRide.get(row.id);
    const driverCents = Number(commission?.driver_cents ?? cents);

    if (commission?.driver_paid_out) {
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
    completedRides: rides?.length ?? 0,
    totalDriverCents: primary.totalDriverCents,
    pendingPayoutCents: primary.pendingPayoutCents,
    paidPayoutCents: primary.paidPayoutCents,
    currency: primary.currency,
    byCurrency,
  };
}
