import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPayoutMethodsForRecipient } from "@/lib/payoutMethodRouting";
import { getWalletBalance } from "@/lib/payoutTransactionService";
import { normalizeCountryCode } from "@/lib/paymentProviderRouting";
import { stripe } from "@/lib/stripe";
import {
  deriveStripeConnectStatus,
  stripeConnectStatusLabel,
  stripeConnectUserMessage,
  type StripeConnectStatusCode,
} from "@/lib/stripeConnectStatus";
import { getPricingBusinessDefault } from "@/lib/pricingEngine/config/businessDefaults";

const CURRENCY_BY_COUNTRY: Record<string, string> = {
  US: "USD",
  CA: "CAD",
  GB: "GBP",
  FR: "EUR",
  GN: "GNF",
  SN: "XOF",
  CI: "XOF",
};

/** Minimum Cash Out from Connect available balance ($20). Phase 1 config. */
export const DRIVER_CASHOUT_MINIMUM_CENTS = getPricingBusinessDefault(
  "driver_cashout_minimum_cents"
);

/** Rolling 24h cashout cooldown window. Phase 1 config. */
export const DRIVER_CASHOUT_COOLDOWN_MS = getPricingBusinessDefault(
  "driver_cashout_cooldown_ms"
);

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function currencyForCountry(countryCode: string): string {
  return CURRENCY_BY_COUNTRY[normalizeCountryCode(countryCode)] ?? "USD";
}

function isWithinCashoutCooldown(lastCashoutAt: string | null, now = new Date()): boolean {
  if (!lastCashoutAt) return false;
  const last = new Date(lastCashoutAt).getTime();
  if (!Number.isFinite(last)) return false;
  return now.getTime() - last < DRIVER_CASHOUT_COOLDOWN_MS;
}

function payloadSource(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const source = (payload as { source?: unknown }).source;
  return String(source ?? "").trim().toLowerCase();
}

/** Live Connect USD balances (available + pending). */
export async function fetchConnectUsdBalanceCents(
  stripeAccountId: string
): Promise<{ availableCents: number; pendingCents: number }> {
  const balance = await stripe.balance.retrieve({
    stripeAccount: stripeAccountId,
  });
  const availableCents = (balance.available ?? [])
    .filter((row) => String(row.currency ?? "").toLowerCase() === "usd")
    .reduce((sum, row) => sum + Math.max(0, Math.round(Number(row.amount ?? 0))), 0);
  const pendingCents = (balance.pending ?? [])
    .filter((row) => String(row.currency ?? "").toLowerCase() === "usd")
    .reduce((sum, row) => sum + Math.max(0, Math.round(Number(row.amount ?? 0))), 0);
  return { availableCents, pendingCents };
}

/**
 * Unpaid delivery earnings not yet SCT'd to Connect (orders + delivery_requests).
 * Exported for parity / wallet awaiting_transfer_cents.
 *
 * Tips are intentionally EXCLUDED here — see
 * `@/lib/finance/tipMoneyArchitecture` for the single tip rule. A tip is only
 * ever moved once its own PaymentIntent has succeeded (executeDriverTipTransfer),
 * so it must never inflate this "awaiting platform SCT" figure.
 */
export async function computeDriverAvailableCents(
  supabaseAdmin: SupabaseClient,
  driverUserId: string
): Promise<number> {
  const { data: deliveredOrders, error: ordersErr } = await supabaseAdmin
    .from("orders")
    .select("driver_delivery_payout, driver_payout_id")
    .eq("driver_id", driverUserId)
    .eq("status", "delivered")
    .eq("driver_paid_out", false)
    .is("driver_payout_id", null);

  if (ordersErr) throw new Error(ordersErr.message);

  const { data: deliveredRequests, error: requestsErr } = await supabaseAdmin
    .from("delivery_requests")
    .select("driver_delivery_payout, driver_payout_id")
    .eq("driver_id", driverUserId)
    .eq("status", "delivered")
    .or("driver_paid_out.eq.false,driver_paid_out.is.null")
    .is("driver_payout_id", null);

  if (requestsErr) throw new Error(requestsErr.message);

  const ordersAvailableCents = (deliveredOrders ?? []).reduce((sum, row) => {
    return sum + Math.round(toNumber(row.driver_delivery_payout) * 100);
  }, 0);

  const requestsAvailableCents = (deliveredRequests ?? []).reduce((sum, row) => {
    return sum + Math.round(toNumber(row.driver_delivery_payout) * 100);
  }, 0);

  return ordersAvailableCents + requestsAvailableCents;
}

async function computeDriverPendingPayoutTxCents(
  supabaseAdmin: SupabaseClient,
  driverUserId: string
): Promise<number> {
  let pendingCents = 0;

  const { data: legacyPayouts, error: legacyErr } = await supabaseAdmin
    .from("driver_payouts")
    .select("amount, status")
    .eq("driver_id", driverUserId)
    .in("status", ["scheduled", "processing"]);

  if (legacyErr) throw new Error(legacyErr.message);

  pendingCents += (legacyPayouts ?? []).reduce(
    (sum, row) => sum + Math.round(toNumber(row.amount) * 100),
    0
  );

  const { data: payoutRows, error: payoutErr } = await supabaseAdmin
    .from("payout_transactions")
    .select("amount_cents, status")
    .eq("recipient_user_id", driverUserId)
    .eq("recipient_type", "driver")
    .in("status", ["pending", "approved", "processing"]);

  if (payoutErr && payoutErr.code !== "42P01") {
    throw new Error(payoutErr.message);
  }

  pendingCents += (payoutRows ?? []).reduce(
    (sum, row) => sum + Math.max(0, Math.round(toNumber(row.amount_cents))),
    0
  );

  return pendingCents;
}

/**
 * Rate-limit: stripe_connect payout_transactions in processing/paid within 24h,
 * or provider_payload.source mobile_wallet_cashout within 24h.
 */
export async function isDriverCashoutRateLimited(
  supabaseAdmin: SupabaseClient,
  driverUserId: string,
  now = new Date()
): Promise<{ limited: boolean; lastCashoutAt: string | null }> {
  const sinceIso = new Date(now.getTime() - DRIVER_CASHOUT_COOLDOWN_MS).toISOString();

  const { data: rows, error } = await supabaseAdmin
    .from("payout_transactions")
    .select("created_at, status, provider, provider_payload")
    .eq("recipient_user_id", driverUserId)
    .eq("recipient_type", "driver")
    .eq("provider", "stripe_connect")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error && error.code !== "42P01") {
    throw new Error(error.message);
  }

  for (const row of rows ?? []) {
    const status = String(row.status ?? "").toLowerCase();
    const source = payloadSource(row.provider_payload);
    const isCashoutSource =
      source === "mobile_wallet_cashout" ||
      source === "mobile_wallet_cashout_vercel";
    if (status === "processing" || status === "paid" || isCashoutSource) {
      return {
        limited: true,
        lastCashoutAt: row.created_at ? String(row.created_at) : null,
      };
    }
  }

  return { limited: false, lastCashoutAt: null };
}

async function resolveLastCashoutAt(
  supabaseAdmin: SupabaseClient,
  driverUserId: string
): Promise<string | null> {
  const rate = await isDriverCashoutRateLimited(supabaseAdmin, driverUserId);
  if (rate.lastCashoutAt) return rate.lastCashoutAt;

  const { data: payoutRows, error: payoutErr } = await supabaseAdmin
    .from("payout_transactions")
    .select("created_at, status, provider, provider_payload")
    .eq("recipient_user_id", driverUserId)
    .eq("recipient_type", "driver")
    .eq("provider", "stripe_connect")
    .in("status", ["processing", "paid"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (payoutErr && payoutErr.code !== "42P01") {
    throw new Error(payoutErr.message);
  }

  return payoutRows?.[0]?.created_at ? String(payoutRows[0].created_at) : null;
}

export type DriverWalletSummary = {
  account_type: "driver";
  country_code: string;
  currency: string;
  balance_cents: number;
  /** Connect available balance (cashable). */
  available_cents: number;
  /** Unpaid delivery earnings awaiting platform→Connect SCT. */
  awaiting_transfer_cents: number;
  /** Connect pending + in-flight payout transactions. */
  pending_cents: number;
  minimum_payout_cents: number;
  cashout_blocked_today: boolean;
  last_cashout_at: string | null;
  stripe_account_id: string | null;
  stripe_onboarded: boolean;
  stripe_status: StripeConnectStatusCode;
  stripe_status_label: string;
  stripe_status_message: string;
  can_cashout: boolean;
  cashout_block_reason: string | null;
  /** True when stripe_status / can_cashout used live Stripe retrieve. */
  stripe_live_verified: boolean;
};

export async function buildDriverWalletSummary(
  supabaseAdmin: SupabaseClient,
  driverUserId: string,
  countryCodeInput?: string | null
): Promise<DriverWalletSummary> {
  const countryCode = normalizeCountryCode(countryCodeInput ?? "US");
  const currency = currencyForCountry(countryCode);

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("driver_profiles")
    .select("stripe_account_id, stripe_onboarded")
    .eq("user_id", driverUserId)
    .maybeSingle();

  if (profileErr) throw new Error(profileErr.message);

  const [
    balanceCents,
    awaitingTransferCents,
    pendingPayoutTxCents,
    payoutMethods,
    lastCashoutAt,
    rateLimit,
  ] = await Promise.all([
    getWalletBalance(supabaseAdmin, "driver", driverUserId, currency),
    computeDriverAvailableCents(supabaseAdmin, driverUserId),
    computeDriverPendingPayoutTxCents(supabaseAdmin, driverUserId),
    loadPayoutMethodsForRecipient(supabaseAdmin, countryCode, "driver"),
    resolveLastCashoutAt(supabaseAdmin, driverUserId),
    isDriverCashoutRateLimited(supabaseAdmin, driverUserId),
  ]);

  const defaultMethod =
    payoutMethods.find((method) => method.available) ?? payoutMethods[0] ?? null;
  const minimumPayoutCents = Math.max(
    DRIVER_CASHOUT_MINIMUM_CENTS,
    defaultMethod?.minimum_payout_cents ?? DRIVER_CASHOUT_MINIMUM_CENTS,
  );

  const stripeAccountId = profile?.stripe_account_id
    ? String(profile.stripe_account_id)
    : null;

  let stripeOnboarded = Boolean(profile?.stripe_onboarded);
  let detailsSubmitted: boolean | null = stripeOnboarded ? true : null;
  let chargesEnabled: boolean | null = stripeOnboarded ? true : null;
  let payoutsEnabled: boolean | null = stripeOnboarded ? true : null;
  let stripeLiveVerified = false;
  let connectAvailableCents = 0;
  let connectPendingCents = 0;

  // Same live triad as POST /api/wallet/driver-cashout — never enable cashout
  // from the DB boolean alone when an Express account id exists.
  if (stripeAccountId) {
    try {
      const connectAccount = await stripe.accounts.retrieve(stripeAccountId);
      detailsSubmitted = Boolean(connectAccount.details_submitted);
      chargesEnabled = Boolean(connectAccount.charges_enabled);
      payoutsEnabled = Boolean(connectAccount.payouts_enabled);
      stripeOnboarded = detailsSubmitted && chargesEnabled && payoutsEnabled;
      stripeLiveVerified = true;

      try {
        const bal = await fetchConnectUsdBalanceCents(stripeAccountId);
        connectAvailableCents = bal.availableCents;
        connectPendingCents = bal.pendingCents;
      } catch {
        connectAvailableCents = 0;
        connectPendingCents = 0;
      }
    } catch {
      // Fail closed for cashout eligibility when Stripe is unreachable.
      detailsSubmitted = false;
      chargesEnabled = false;
      payoutsEnabled = false;
      stripeOnboarded = false;
      stripeLiveVerified = false;
      connectAvailableCents = 0;
      connectPendingCents = 0;
    }
  }

  const stripeStatus = deriveStripeConnectStatus({
    stripe_account_id: stripeAccountId,
    details_submitted: detailsSubmitted,
    charges_enabled: chargesEnabled,
    payouts_enabled: payoutsEnabled,
  });

  const cashoutBlockedCooldown =
    rateLimit.limited || isWithinCashoutCooldown(lastCashoutAt);
  const availableCents = stripeAccountId ? connectAvailableCents : 0;
  const pendingCents = connectPendingCents + pendingPayoutTxCents;

  let cashoutBlockReason: string | null = null;
  if (!stripeAccountId || !stripeOnboarded) {
    cashoutBlockReason = "stripe_setup_required";
  } else if (cashoutBlockedCooldown) {
    cashoutBlockReason = "already_cashed_out_today";
  } else if (availableCents < minimumPayoutCents) {
    cashoutBlockReason = "below_minimum";
  }

  const canCashout =
    cashoutBlockReason === null &&
    stripeLiveVerified &&
    stripeOnboarded &&
    availableCents >= minimumPayoutCents &&
    !cashoutBlockedCooldown;

  return {
    account_type: "driver",
    country_code: countryCode,
    currency,
    balance_cents: balanceCents,
    available_cents: availableCents,
    awaiting_transfer_cents: awaitingTransferCents,
    pending_cents: pendingCents,
    minimum_payout_cents: minimumPayoutCents,
    cashout_blocked_today: cashoutBlockedCooldown,
    last_cashout_at: rateLimit.lastCashoutAt ?? lastCashoutAt,
    stripe_account_id: stripeAccountId,
    stripe_onboarded: stripeOnboarded,
    stripe_status: stripeStatus,
    stripe_status_label: stripeConnectStatusLabel(stripeStatus),
    stripe_status_message: stripeConnectUserMessage(stripeStatus),
    can_cashout: canCashout,
    cashout_block_reason: cashoutBlockReason,
    stripe_live_verified: stripeLiveVerified,
  };
}
