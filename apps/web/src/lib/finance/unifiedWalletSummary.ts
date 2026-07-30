import type { SupabaseClient } from "@supabase/supabase-js";
import { MONEY_OUT_MODEL } from "@/lib/finance/moneyOutArchitecture";
import { getWalletBalance } from "@/lib/payoutTransactionService";
import { getRestaurantFinancialOverview } from "@/lib/restaurantFinancialOverview";
import { normalizeCountryCode } from "@/lib/paymentProviderRouting";

export type SharedWalletSummary = {
  account_type: "restaurant" | "seller" | "partner" | "client";
  country_code: string;
  currency: string;
  /** Legacy ledger balance (kept for backward compatibility). */
  balance_cents: number;
  /** Cashable now — restaurants/sellers typically 0 (Express auto after SCT). */
  available_cents: number;
  /** Earnings not yet SCT'd to Connect (or pending Express bank payout). */
  awaiting_transfer_cents: number;
  pending_cents: number;
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

const CURRENCY_BY_COUNTRY: Record<string, string> = {
  US: "USD",
  CA: "CAD",
  GB: "GBP",
  FR: "EUR",
  GN: "GNF",
  SN: "XOF",
  CI: "XOF",
};

function currencyForCountry(countryCode: string): string {
  return CURRENCY_BY_COUNTRY[normalizeCountryCode(countryCode)] ?? "USD";
}

/**
 * Restaurant wallets: SCT funds Connect; Express auto-pays bank.
 * Unpaid order nets show as awaiting_transfer; available cashout is 0.
 */
export async function buildRestaurantWalletSummary(
  supabaseAdmin: SupabaseClient,
  restaurantUserId: string,
  countryCodeInput?: string | null
): Promise<SharedWalletSummary> {
  const countryCode = normalizeCountryCode(countryCodeInput ?? "US");
  const currency = currencyForCountry(countryCode);

  const [balanceCents, overview] = await Promise.all([
    getWalletBalance(supabaseAdmin, "restaurant", restaurantUserId, currency),
    getRestaurantFinancialOverview({
      supabase: supabaseAdmin,
      restaurantUserId,
    }),
  ]);

  // pendingPayout is in currency units (dollars); convert to cents.
  const awaitingTransferCents = Math.max(
    0,
    Math.round(Number(overview.pendingPayout ?? 0) * 100)
  );

  return {
    account_type: "restaurant",
    country_code: countryCode,
    currency: overview.currency || currency,
    balance_cents: balanceCents,
    available_cents: 0,
    awaiting_transfer_cents: awaitingTransferCents,
    pending_cents: awaitingTransferCents,
    can_cashout: false,
    cashout_block_reason: "express_auto_payout",
    note:
      awaitingTransferCents > 0
        ? "Pending restaurant earnings await SCT transfer; bank payout is Stripe Express automatic."
        : "Restaurants cash out via Stripe Express auto-payout after SCT.",
    money_out_model: MONEY_OUT_MODEL,
  };
}

/**
 * Seller wallets: sum unpaid marketplace_seller_payouts as awaiting_transfer.
 */
export async function buildSellerWalletSummary(
  supabaseAdmin: SupabaseClient,
  sellerUserId: string,
  countryCodeInput?: string | null
): Promise<SharedWalletSummary> {
  const countryCode = normalizeCountryCode(countryCodeInput ?? "US");
  const currency = currencyForCountry(countryCode);

  const balanceCents = await getWalletBalance(
    supabaseAdmin,
    "seller",
    sellerUserId,
    currency
  );

  // Resolve seller profile id(s) owned by this user if needed; payouts key on seller_id.
  const { data: sellerRows, error: sellerErr } = await supabaseAdmin
    .from("sellers")
    .select("id")
    .eq("user_id", sellerUserId)
    .limit(20);

  if (sellerErr && sellerErr.code !== "42P01") {
    throw new Error(sellerErr.message);
  }

  const sellerIds = (sellerRows ?? [])
    .map((row) => String((row as { id?: string }).id ?? "").trim())
    .filter(Boolean);

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

  return {
    account_type: "seller",
    country_code: countryCode,
    currency,
    balance_cents: balanceCents,
    available_cents: paidOutCents,
    awaiting_transfer_cents: awaitingTransferCents,
    pending_cents: awaitingTransferCents,
    paid_out_cents: paidOutCents,
    platform_fees_cents: platformFeesCents,
    refunded_cents: refundedCents,
    can_cashout: false,
    cashout_block_reason: "express_auto_payout",
    note:
      awaitingTransferCents > 0
        ? "Unpaid marketplace seller payouts await SCT transfer to Connect."
        : "Sellers receive funds via Stripe Connect transfer + Express auto-payout.",
    money_out_model: MONEY_OUT_MODEL,
  };
}
