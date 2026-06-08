import { supabase } from "./supabase";

export type TaxiEarningsSummary = {
  completedRides: number;
  totalDriverCents: number;
  pendingPayoutCents: number;
  paidPayoutCents: number;
  currency: string;
};

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

  let totalDriverCents = 0;
  let pendingPayoutCents = 0;
  let paidPayoutCents = 0;
  let currency = "USD";

  const commissionByRide = new Map(commissions.map((c) => [c.taxi_ride_id, c]));

  for (const row of rides ?? []) {
    const cents = Number(row.driver_payout_cents ?? 0);
    totalDriverCents += cents;
    if (row.currency) currency = String(row.currency);

    const commission = commissionByRide.get(row.id);
    const driverCents = Number(commission?.driver_cents ?? cents);

    if (commission?.driver_paid_out) {
      paidPayoutCents += driverCents;
    } else {
      pendingPayoutCents += driverCents;
    }
  }

  return {
    completedRides: rides?.length ?? 0,
    totalDriverCents,
    pendingPayoutCents,
    paidPayoutCents,
    currency,
  };
}
