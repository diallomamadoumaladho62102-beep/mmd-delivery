import { retrieveConnectBalance } from "@/lib/stripe";

export type ConnectUsdBalances = {
  /** Standard Connect available (Sunday bank + Instant fallback). */
  availableCents: number;
  /** Stripe settlement pending on Connect. */
  pendingCents: number;
  /**
   * Stripe Instant Payout eligible balance when Instant Payouts is enabled.
   * Often includes funds still in `pending` for standard payouts — never treat as
   * "fake available" without attempting Instant Payouts (or confirming eligibility).
   */
  instantAvailableCents: number;
};

function sumUsd(rows: Array<{ amount?: number | null; currency?: string | null }> | null | undefined): number {
  return (rows ?? [])
    .filter((row) => String(row.currency ?? "").toLowerCase() === "usd")
    .reduce((sum, row) => sum + Math.max(0, Math.round(Number(row.amount ?? 0))), 0);
}

/** Live Connect USD balances (available + pending + instant_available). */
export async function fetchConnectUsdBalanceCents(
  stripeAccountId: string,
): Promise<ConnectUsdBalances> {
  const balance = await retrieveConnectBalance(stripeAccountId);
  const availableCents = sumUsd(balance.available);
  const pendingCents = sumUsd(balance.pending);
  const instantAvailableCents = sumUsd(
    (balance as { instant_available?: Array<{ amount?: number | null; currency?: string | null }> })
      .instant_available,
  );
  return { availableCents, pendingCents, instantAvailableCents };
}
