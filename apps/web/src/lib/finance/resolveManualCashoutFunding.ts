/**
 * Resolve Instant Cash Out eligibility for a Connect Express account.
 *
 * Manual Cash Out rules:
 * - Instant Payout to an Instant-eligible debit card (`card_`) OR
 *   Instant-eligible bank account (`ba_`) — Stripe `available_payout_methods`
 * - cashableCents = instant_available when an Instant destination exists, else 0
 * - Never treat pending or standard `available` as cashable
 * - No standard fallback (Sunday bank payout is separate)
 */
import { fetchConnectUsdBalanceCents } from "@/lib/finance/connectUsdBalance";
import { selectInstantPayoutDestination } from "@/lib/finance/selectInstantPayoutDestination";
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
  /** Instant destination: `card_…` or Instant-eligible `ba_…` */
  instantDestinationId: string | null;
};

function capabilityStatus(
  account: { capabilities?: Record<string, string | null | undefined> | null },
  key: string,
): string {
  return String(account.capabilities?.[key] ?? "").toLowerCase();
}

async function listConnectExternalAccounts(stripeAccountId: string) {
  const settled = await Promise.allSettled([
    stripe.accounts.listExternalAccounts(stripeAccountId, {
      object: "card",
      limit: 10,
    }),
    stripe.accounts.listExternalAccounts(stripeAccountId, {
      object: "bank_account",
      limit: 10,
    }),
  ]);
  const rows: Array<{
    id?: string | null;
    object?: string | null;
    currency?: string | null;
    default_for_currency?: boolean | null;
    available_payout_methods?: Array<string | null> | null;
  }> = [];
  let listed = false;
  for (const item of settled) {
    if (item.status !== "fulfilled") continue;
    listed = true;
    rows.push(...(item.value.data ?? []));
  }
  if (!listed) {
    throw new Error("external_accounts_lookup_failed");
  }
  return rows;
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

  let externalAccounts: Array<{
    id?: string | null;
    object?: string | null;
    currency?: string | null;
    default_for_currency?: boolean | null;
    available_payout_methods?: Array<string | null> | null;
  }> = [];
  try {
    externalAccounts = await listConnectExternalAccounts(stripeAccountId);
  } catch {
    return { ...base, instantBlockReason: "external_accounts_lookup_failed" };
  }

  const instantDestinationId = selectInstantPayoutDestination(externalAccounts);
  if (!instantDestinationId) {
    return { ...base, instantBlockReason: "no_instant_payout_destination" };
  }

  return {
    ...base,
    instantEligible: true,
    instantBlockReason: null,
    method: "instant",
    cashableCents: bal.instantAvailableCents,
    instantDestinationId,
  };
}
