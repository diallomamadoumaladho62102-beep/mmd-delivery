/**
 * Resolve Instant Cash Out eligibility for a Connect Express account.
 *
 * Manual Cash Out rules:
 * - Instant Payout ONLY to an Instant-eligible debit card
 * - cashableCents = instant_available when eligible, else 0
 * - Never treat pending as cashable
 * - No standard fallback (Sunday bank payout is separate)
 */
import { fetchConnectUsdBalanceCents } from "@/lib/finance/connectUsdBalance";
import { stripe } from "@/lib/stripe";

export type ManualCashoutFunding = {
  availableCents: number;
  pendingCents: number;
  instantAvailableCents: number;
  instantEligible: boolean;
  instantBlockReason: string | null;
  method: "instant";
  /** 100% of Instant-eligible balance, or 0. */
  cashableCents: number;
  /** card_… Instant destination */
  instantDestinationId: string | null;
};

function capabilityStatus(
  account: { capabilities?: Record<string, string | null | undefined> | null },
  key: string,
): string {
  return String(account.capabilities?.[key] ?? "").toLowerCase();
}

function supportsInstant(row: {
  available_payout_methods?: string[] | null;
}): boolean {
  // Stripe ExternalAccount field: available_payout_methods (instant|standard)
  return (row.available_payout_methods ?? [])
    .map((m) => String(m).toLowerCase())
    .includes("instant");
}

export async function resolveManualCashoutFunding(
  stripeAccountId: string,
): Promise<ManualCashoutFunding> {
  const bal = await fetchConnectUsdBalanceCents(stripeAccountId);
  const base: ManualCashoutFunding = {
    availableCents: bal.availableCents,
    pendingCents: bal.pendingCents,
    instantAvailableCents: bal.instantAvailableCents,
    instantEligible: false,
    instantBlockReason: null,
    method: "instant",
    cashableCents: 0,
    instantDestinationId: null,
  };

  if (bal.instantAvailableCents <= 0) {
    return { ...base, instantBlockReason: "instant_available_zero" };
  }

  try {
    const account = await stripe.accounts.retrieve(stripeAccountId);
    const cap = capabilityStatus(
      account as unknown as {
        capabilities?: Record<string, string | null | undefined> | null;
      },
      "instant_payouts",
    );
    if (cap === "inactive" || cap === "pending") {
      return { ...base, instantBlockReason: `instant_capability_${cap}` };
    }
  } catch {
    return { ...base, instantBlockReason: "account_retrieve_failed" };
  }

  let instantCardId: string | null = null;
  try {
    const cards = await stripe.accounts.listExternalAccounts(stripeAccountId, {
      object: "card",
      limit: 10,
    });
    for (const row of cards.data ?? []) {
      if (supportsInstant(row as { available_payout_methods?: string[] | null })) {
        const id = String((row as { id?: string }).id ?? "");
        if (id.startsWith("card_")) {
          instantCardId = id;
          break;
        }
      }
    }
  } catch {
    return { ...base, instantBlockReason: "external_accounts_lookup_failed" };
  }

  if (!instantCardId) {
    return { ...base, instantBlockReason: "no_instant_debit_card" };
  }

  return {
    ...base,
    instantEligible: true,
    instantBlockReason: null,
    method: "instant",
    cashableCents: bal.instantAvailableCents,
    instantDestinationId: instantCardId,
  };
}
