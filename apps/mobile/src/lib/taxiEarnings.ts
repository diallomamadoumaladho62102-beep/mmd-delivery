import { supabase } from "./supabase";

export type TaxiEarningsSummary = {
  completedRides: number;
  totalDriverCents: number;
  currency: string;
};

/** Aggregates completed taxi rides for the signed-in driver (no dedicated UI yet). */
export async function loadTaxiDriverEarnings(
  driverId: string
): Promise<TaxiEarningsSummary> {
  const { data, error } = await supabase
    .from("taxi_rides")
    .select("driver_payout_cents,currency,status")
    .eq("driver_id", driverId)
    .eq("status", "completed");

  if (error) {
    throw new Error(error.message);
  }

  let totalDriverCents = 0;
  let currency = "USD";

  for (const row of data ?? []) {
    totalDriverCents += Number(row.driver_payout_cents ?? 0);
    if (row.currency) currency = String(row.currency);
  }

  return {
    completedRides: data?.length ?? 0,
    totalDriverCents,
    currency,
  };
}
