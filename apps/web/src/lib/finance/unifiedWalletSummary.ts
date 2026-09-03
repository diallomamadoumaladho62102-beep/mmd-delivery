import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isManualCashoutBlockedToday,
} from "@/lib/finance/manualCashoutService";
import { MONEY_OUT_MODEL } from "@/lib/finance/moneyOutArchitecture";
import { getWalletBalance } from "@/lib/payoutTransactionService";
import { getRestaurantFinancialOverview } from "@/lib/restaurantFinancialOverview";
import { currencyForPlatformCountry } from "@/lib/platformCurrency";
import { normalizeCountryCode } from "@/lib/paymentProviderRouting";
import { fetchConnectUsdBalanceCents } from "@/lib/finance/connectUsdBalance";
import { resolveManualCashoutFunding } from "@/lib/finance/resolveManualCashoutFunding";
import { stripe } from "@/lib/stripe";

export type SharedWalletSummary = {
  account_type: "restaurant" | "seller" | "partner" | "client";
  country_code: string;
  currency: string;
  /** Legacy ledger balance (kept for backward compatibility). */
  balance_cents: number;
  /**
   * Cashable now for manual Cash Out: Stripe instant_available when an Instant
   * destination exists (card or Instant-eligible bank); otherwise 0.
   */
  available_cents: number;
  /** Earnings not yet SCT'd to Connect (awaiting platform→Connect Transfer). */
  awaiting_transfer_cents: number;
  /** Connect pending settlement only. */
  settling_cents: number;
  /** @deprecated Prefer settling_cents; kept for older clients (= settling only). */
  pending_cents: number;
  confirmed_earnings_cents: number;
  connect_available_cents: number;
  instant_available_cents: number;
  instant_payout_eligible: boolean;
  instant_block_reason: string | null;
  minimum_payout_cents?: number;
  cashout_blocked_today?: boolean;
  last_cashout_at?: string | null;
  stripe_account_id?: string | null;
  stripe_onboarded?: boolean;
  /** Seller: total net already transferred (paid payouts). */
  paid_out_cents?: number;
  /** Seller: cumulative platform commission fees. */
  platform_fees_cents?: number;
  /** Seller: refunded order totals. */
  refunded_cents?: number;
  can_cashout: boolean;
  cashout_block_reason: string | null;
  note: string | null;
  money_out_model: typeof MONEY_OUT_MODEL;
};

function currencyForCountry(countryCode: string): string {
  return currencyForPlatformCountry(normalizeCountryCode(countryCode));
}

async function hasActiveManualCashoutToday(
  supabaseAdmin: SupabaseClient,
  recipientType: "restaurant" | "seller",
  userId: string,
): Promise<{ blocked: boolean; lastCashoutAt: string | null }> {
  return isManualCashoutBlockedToday(supabaseAdmin, recipientType, userId);
}

async function loadLiveConnectState(stripeAccountId: string | null): Promise<{
  onboarded: boolean;
  liveVerified: boolean;
  availableCents: number;
  pendingCents: number;
  instantAvailableCents: number;
  cashableCents: number;
  instantEligible: boolean;
  instantBlockReason: string | null;
}> {
  if (!stripeAccountId) {
    return {
      onboarded: false,
      liveVerified: false,
      availableCents: 0,
      pendingCents: 0,
      instantAvailableCents: 0,
      cashableCents: 0,
      instantEligible: false,
      instantBlockReason: null,
    };
  }
  try {
    const account = await stripe.accounts.retrieve(stripeAccountId);
    const onboarded = Boolean(
      account.details_submitted &&
        account.charges_enabled &&
        account.payouts_enabled,
    );
    let availableCents = 0;
    let pendingCents = 0;
    let instantAvailableCents = 0;
    let cashableCents = 0;
    let instantEligible = false;
    let instantBlockReason: string | null = null;
    try {
      const funding = await resolveManualCashoutFunding(stripeAccountId);
      availableCents = funding.availableCents;
      pendingCents = funding.pendingCents;
      instantAvailableCents = funding.instantAvailableCents;
      cashableCents = funding.cashableCents;
      instantEligible = funding.instantEligible;
      instantBlockReason = funding.instantBlockReason;
    } catch {
      try {
        const bal = await fetchConnectUsdBalanceCents(stripeAccountId);
        availableCents = bal.availableCents;
        pendingCents = bal.pendingCents;
        instantAvailableCents = bal.instantAvailableCents;
        cashableCents = 0;
        instantEligible = false;
        instantBlockReason = "funding_resolve_failed";
      } catch {
        availableCents = 0;
        pendingCents = 0;
        instantAvailableCents = 0;
        cashableCents = 0;
      }
    }
    return {
      onboarded,
      liveVerified: true,
      availableCents,
      pendingCents,
      instantAvailableCents,
      cashableCents,
      instantEligible,
      instantBlockReason,
    };
  } catch {
    return {
      onboarded: false,
      liveVerified: false,
      availableCents: 0,
      pendingCents: 0,
      instantAvailableCents: 0,
      cashableCents: 0,
      instantEligible: false,
      instantBlockReason: null,
    };
  }
}

function resolveCashoutGate(input: {
  stripeAccountId: string | null;
  onboarded: boolean;
  liveVerified: boolean;
  /** Instant-cashable cents only (never pending / standard-only available). */
  availableCents: number;
  blockedToday: boolean;
  /** Stripe Instant block reason from resolveManualCashoutFunding when cashable is 0. */
  instantBlockReason?: string | null;
}): { canCashout: boolean; reason: string | null } {
  if (!input.stripeAccountId || !input.onboarded || !input.liveVerified) {
    return { canCashout: false, reason: "stripe_setup_required" };
  }
  if (input.blockedToday) {
    return { canCashout: false, reason: "already_cashed_out_today" };
  }
  if (input.availableCents <= 0) {
    // Prefer precise Stripe Instant reason so clients never claim false "available".
    return {
      canCashout: false,
      reason: input.instantBlockReason || "instant_not_eligible",
    };
  }
  return { canCashout: true, reason: null };
}

/**
 * Restaurant wallets: SCT → Connect Instant cashable → manual Cash Out (no $ min / 1/day)
 * and/or Sunday 04:00 America/New_York bank cron for remaining balance.
 */
export async function buildRestaurantWalletSummary(
  supabaseAdmin: SupabaseClient,
  restaurantUserId: string,
  countryCodeInput?: string | null,
): Promise<SharedWalletSummary> {
  const countryCode = normalizeCountryCode(countryCodeInput ?? "US");
  const currency = currencyForCountry(countryCode);

  const [balanceCents, overview, profileRes, dayLimit] = await Promise.all([
    getWalletBalance(supabaseAdmin, "restaurant", restaurantUserId, currency),
    getRestaurantFinancialOverview({
      supabase: supabaseAdmin,
      restaurantUserId,
    }),
    supabaseAdmin
      .from("restaurant_profiles")
      .select("stripe_account_id, stripe_onboarded")
      .eq("user_id", restaurantUserId)
      .maybeSingle(),
    hasActiveManualCashoutToday(supabaseAdmin, "restaurant", restaurantUserId),
  ]);

  if (profileRes.error) throw new Error(profileRes.error.message);

  const awaitingTransferCents = Math.max(
    0,
    Math.round(Number(overview.pendingPayout ?? 0) * 100),
  );

  const stripeAccountId = profileRes.data?.stripe_account_id
    ? String(profileRes.data.stripe_account_id)
    : null;
  const connect = await loadLiveConnectState(stripeAccountId);
  const gate = resolveCashoutGate({
    stripeAccountId,
    onboarded: connect.onboarded,
    liveVerified: connect.liveVerified,
    availableCents: connect.cashableCents,
    blockedToday: dayLimit.blocked,
    instantBlockReason: connect.instantBlockReason,
  });

  return {
    account_type: "restaurant",
    country_code: countryCode,
    currency: overview.currency || currency,
    balance_cents: balanceCents,
    available_cents: connect.cashableCents,
    awaiting_transfer_cents: awaitingTransferCents,
    settling_cents: connect.pendingCents,
    pending_cents: connect.pendingCents,
    confirmed_earnings_cents:
      awaitingTransferCents + connect.availableCents + connect.pendingCents,
    connect_available_cents: connect.availableCents,
    instant_available_cents: connect.instantAvailableCents,
    instant_payout_eligible: connect.instantEligible,
    instant_block_reason: connect.instantBlockReason,
    minimum_payout_cents: 0,
    cashout_blocked_today: dayLimit.blocked,
    last_cashout_at: dayLimit.lastCashoutAt,
    stripe_account_id: stripeAccountId,
    stripe_onboarded: connect.onboarded,
    can_cashout: gate.canCashout,
    cashout_block_reason: gate.reason,
    note:
      awaitingTransferCents > 0
        ? "Confirmed restaurant earnings await platform→Connect SCT. Instant Cash Out when Stripe Instant destination is eligible (no minimum, 1/day ET). Sunday 04:00 ET pays remaining available to bank."
        : "Instant Cash Out when Instant-eligible (no minimum, 1/day ET). Sunday 04:00 America/New_York pays remaining available to bank.",
    money_out_model: MONEY_OUT_MODEL,
  };
}

/**
 * Seller wallets: unpaid marketplace_seller_payouts as awaiting_transfer;
 * Connect Instant-eligible amount is cashable via manual Cash Out (no $ min / 1/day ET).
 */
export async function buildSellerWalletSummary(
  supabaseAdmin: SupabaseClient,
  sellerUserId: string,
  countryCodeInput?: string | null,
): Promise<SharedWalletSummary> {
  const countryCode = normalizeCountryCode(countryCodeInput ?? "US");
  const currency = currencyForCountry(countryCode);

  const balanceCents = await getWalletBalance(
    supabaseAdmin,
    "seller",
    sellerUserId,
    currency,
  );

  const { data: sellerRows, error: sellerErr } = await supabaseAdmin
    .from("sellers")
    .select("id, stripe_account_id, stripe_onboarding_status")
    .eq("user_id", sellerUserId)
    .limit(20);

  if (sellerErr && sellerErr.code !== "42P01") {
    throw new Error(sellerErr.message);
  }

  const sellerIds = (sellerRows ?? [])
    .map((row) => String((row as { id?: string }).id ?? "").trim())
    .filter(Boolean);

  const stripeAccountId = (() => {
    for (const row of sellerRows ?? []) {
      const acct = String(
        (row as { stripe_account_id?: string | null }).stripe_account_id ?? "",
      ).trim();
      if (acct.startsWith("acct_")) return acct;
    }
    return null;
  })();

  let awaitingTransferCents = 0;
  let paidOutCents = 0;
  let platformFeesCents = 0;
  let refundedCents = 0;

  if (sellerIds.length > 0) {
    const [{ data: payouts, error: payoutErr }, { data: refunds, error: refundErr }] =
      await Promise.all([
        supabaseAdmin
          .from("marketplace_seller_payouts")
          .select("seller_net_amount_cents, platform_fee_cents, status")
          .in("seller_id", sellerIds),
        supabaseAdmin
          .from("seller_orders")
          .select("total_cents, refund_status")
          .in("seller_id", sellerIds)
          .in("refund_status", ["refunded", "partially_refunded"]),
      ]);

    if (payoutErr && payoutErr.code !== "42P01") {
      throw new Error(payoutErr.message);
    }
    if (refundErr && refundErr.code !== "42P01") {
      throw new Error(refundErr.message);
    }

    for (const row of payouts ?? []) {
      const net = Math.max(0, Math.round(Number(row.seller_net_amount_cents ?? 0)));
      const fee = Math.max(0, Math.round(Number(row.platform_fee_cents ?? 0)));
      const status = String(row.status ?? "").toLowerCase();
      platformFeesCents += fee;
      if (status === "pending" || status === "approved") {
        awaitingTransferCents += net;
      } else if (status === "paid") {
        paidOutCents += net;
      }
    }

    refundedCents = (refunds ?? []).reduce((sum, row) => {
      return sum + Math.max(0, Math.round(Number(row.total_cents ?? 0)));
    }, 0);
  }

  const [connect, dayLimit] = await Promise.all([
    loadLiveConnectState(stripeAccountId),
    hasActiveManualCashoutToday(supabaseAdmin, "seller", sellerUserId),
  ]);

  const gate = resolveCashoutGate({
    stripeAccountId,
    onboarded: connect.onboarded,
    liveVerified: connect.liveVerified,
    availableCents: connect.cashableCents,
    blockedToday: dayLimit.blocked,
    instantBlockReason: connect.instantBlockReason,
  });

  return {
    account_type: "seller",
    country_code: countryCode,
    currency,
    balance_cents: balanceCents,
    available_cents: connect.cashableCents,
    awaiting_transfer_cents: awaitingTransferCents,
    settling_cents: connect.pendingCents,
    pending_cents: connect.pendingCents,
    confirmed_earnings_cents:
      awaitingTransferCents + connect.availableCents + connect.pendingCents,
    connect_available_cents: connect.availableCents,
    instant_available_cents: connect.instantAvailableCents,
    instant_payout_eligible: connect.instantEligible,
    instant_block_reason: connect.instantBlockReason,
    minimum_payout_cents: 0,
    cashout_blocked_today: dayLimit.blocked,
    last_cashout_at: dayLimit.lastCashoutAt,
    stripe_account_id: stripeAccountId,
    stripe_onboarded: connect.onboarded,
    paid_out_cents: paidOutCents,
    platform_fees_cents: platformFeesCents,
    refunded_cents: refundedCents,
    can_cashout: gate.canCashout,
    cashout_block_reason: gate.reason,
    note:
      awaitingTransferCents > 0
        ? "Confirmed seller earnings await SCT to Connect. Instant Cash Out when Stripe Instant destination is eligible (no minimum, 1/day ET)."
        : "Instant Cash Out when Instant-eligible (no minimum, 1/day ET). Sunday 04:00 ET pays remaining available to bank.",
    money_out_model: MONEY_OUT_MODEL,
  };
}
