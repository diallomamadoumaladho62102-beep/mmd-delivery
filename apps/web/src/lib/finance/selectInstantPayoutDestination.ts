/**
 * Instant Cash Out destination picker.
 *
 * Stripe Instant Payouts can land on:
 * - Instant-eligible debit cards (`card_`)
 * - Instant-eligible US bank accounts (`ba_`) — e.g. Chase marked
 *   "Eligible for Instant" in Connect Dashboard
 *
 * MMD must follow Stripe `available_payout_methods`, not a card-only filter.
 * Sunday standard payout remains a separate `method: "standard"` path.
 */

export type InstantExternalAccountLike = {
  id?: string | null;
  object?: string | null;
  currency?: string | null;
  default_for_currency?: boolean | null;
  available_payout_methods?: Array<string | null> | null;
};

export function accountSupportsInstantPayout(
  account: InstantExternalAccountLike,
): boolean {
  return (account.available_payout_methods ?? []).some(
    (m) => String(m ?? "").toLowerCase() === "instant",
  );
}

function isInstantDestinationId(id: string): boolean {
  return id.startsWith("card_") || id.startsWith("ba_");
}

/**
 * First Instant-eligible external account Stripe can pay out to.
 * Prefers default_for_currency, then Instant debit card, then Instant bank.
 */
export function selectInstantPayoutDestination(
  accounts: InstantExternalAccountLike[],
  currency = "usd",
): string | null {
  const want = String(currency || "usd").toLowerCase();
  const eligible = accounts.filter((a) => {
    const id = String(a.id ?? "").trim();
    if (!isInstantDestinationId(id)) return false;
    if (!accountSupportsInstantPayout(a)) return false;
    return String(a.currency ?? "usd").toLowerCase() === want;
  });
  if (eligible.length === 0) return null;

  const preferred = eligible.find((a) => a.default_for_currency === true);
  if (preferred?.id) return String(preferred.id).trim();

  const card = eligible.find((a) => String(a.id).startsWith("card_"));
  if (card?.id) return String(card.id).trim();

  const bank = eligible.find((a) => String(a.id).startsWith("ba_"));
  return bank?.id ? String(bank.id).trim() : null;
}
