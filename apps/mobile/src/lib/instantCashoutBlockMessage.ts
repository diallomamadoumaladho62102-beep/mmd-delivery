/**
 * Map Instant Cash Out block reasons to partner-facing copy.
 * Never claim funds are cashable when Stripe Instant is blocked.
 * Pending/settling must never be described as available to cash out.
 */
export function instantCashoutBlockMessage(
  reason: string | null | undefined,
  t: (key: string, defaultValue: string, options?: Record<string, unknown>) => string,
  opts?: { minimumLabel?: string },
): string {
  const code = String(reason ?? "").trim();
  if (!code) return "";

  switch (code) {
    case "stripe_setup_required":
      return t(
        "wallet.cashoutReason.needStripe",
        "Enable Stripe payouts to cash out.",
      );
    case "already_cashed_out_today":
      return t(
        "wallet.cashoutReason.alreadyToday",
        "You already requested a cash out today. Try again tomorrow.",
      );
    case "below_minimum":
      return t("wallet.cashoutReason.min", "Minimum cash out: {{min}}.", {
        min: opts?.minimumLabel ?? "$0.00",
      });
    case "instant_available_zero":
      return t(
        "wallet.cashoutReason.settling",
        "No Instant-eligible balance yet. Funds may still be Stripe pending/settling — Instant Cash Out unlocks when Stripe marks them Instant-available. Sunday 4:00 AM ET bank payout covers remaining available.",
      );
    case "no_instant_payout_destination":
    case "no_instant_debit_card":
      return t(
        "wallet.cashoutReason.needInstantDest",
        "Add an Instant-eligible debit card or bank account in Stripe to Cash Out. Until then, Sunday 4:00 AM ET bank payout sends available funds to your bank.",
      );
    case "instant_capability_inactive":
    case "instant_capability_pending":
      return t(
        "wallet.cashoutReason.capability",
        "Stripe Instant Payouts are not active on this account yet. Use Sunday 4:00 AM ET bank payout for available funds, or finish Stripe verification.",
      );
    case "account_retrieve_failed":
    case "external_accounts_lookup_failed":
    case "funding_resolve_failed":
      return t(
        "wallet.cashoutReason.lookupFailed",
        "Unable to verify Instant Cash Out eligibility right now. Try again shortly.",
      );
    case "instant_not_eligible":
    case "nothing_to_cashout":
      return t(
        "wallet.cashoutReason.instant",
        "Instant Cash Out unavailable. Add an Instant-eligible bank or debit card, or wait for Sunday 4:00 AM ET bank payout.",
      );
    default:
      return code;
  }
}
