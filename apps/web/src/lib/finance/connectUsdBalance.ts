import { retrieveConnectBalance } from "@/lib/stripe";

/** Live Connect USD balances (available + pending). */
export async function fetchConnectUsdBalanceCents(
  stripeAccountId: string,
): Promise<{ availableCents: number; pendingCents: number }> {
  const balance = await retrieveConnectBalance(stripeAccountId);
  const availableCents = (balance.available ?? [])
    .filter((row) => String(row.currency ?? "").toLowerCase() === "usd")
    .reduce((sum, row) => sum + Math.max(0, Math.round(Number(row.amount ?? 0))), 0);
  const pendingCents = (balance.pending ?? [])
    .filter((row) => String(row.currency ?? "").toLowerCase() === "usd")
    .reduce((sum, row) => sum + Math.max(0, Math.round(Number(row.amount ?? 0))), 0);
  return { availableCents, pendingCents };
}
