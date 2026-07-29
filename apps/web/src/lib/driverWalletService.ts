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

const CURRENCY_BY_COUNTRY: Record<string, string> = {
  US: "USD",
  CA: "CAD",
  GB: "GBP",
  FR: "EUR",
  GN: "GNF",
  SN: "XOF",
  CI: "XOF",
};

/** Keep UI + admin_pay_driver_now aligned (hardcoded $20 in RPC). */
export const DRIVER_CASHOUT_MINIMUM_CENTS = 2000;

/** Match admin_pay_driver_now rolling 24h window. */
export const DRIVER_CASHOUT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

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

/** Exported for parity tests vs SQL admin_pay_driver_now available set. */
export async function computeDriverAvailableCents(
  supabaseAdmin: SupabaseClient,
  driverUserId: string
): Promise<number> {
  const { data: deliveredOrders, error: ordersErr } = await supabaseAdmin
    .from("orders")
    .select("driver_delivery_payout, tip_cents, driver_payout_id")
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
    const baseCents = Math.round(toNumber(row.driver_delivery_payout) * 100);
    const tipCents = Math.max(0, Math.round(toNumber(row.tip_cents)));
    return sum + baseCents + tipCents;
  }, 0);

  const requestsAvailableCents = (deliveredRequests ?? []).reduce((sum, row) => {
    return sum + Math.round(toNumber(row.driver_delivery_payout) * 100);
  }, 0);

  return ordersAvailableCents + requestsAvailableCents;
}

async function computeDriverPendingCents(
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

async function resolveLastCashoutAt(
  supabaseAdmin: SupabaseClient,
  driverUserId: string
): Promise<string | null> {
  const { data: legacyRows, error: legacyErr } = await supabaseAdmin
    .from("driver_payouts")
    .select("created_at, status")
    .eq("driver_id", driverUserId)
    .in("status", ["scheduled", "processing", "paid"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (legacyErr) throw new Error(legacyErr.message);

  const legacyAt = legacyRows?.[0]?.created_at ?? null;

  const { data: payoutRows, error: payoutErr } = await supabaseAdmin
    .from("payout_transactions")
    .select("created_at, status")
    .eq("recipient_user_id", driverUserId)
    .eq("recipient_type", "driver")
    .in("status", ["pending", "approved", "processing", "paid"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (payoutErr && payoutErr.code !== "42P01") {
    throw new Error(payoutErr.message);
  }

  const payoutAt = payoutRows?.[0]?.created_at ?? null;

  if (!legacyAt) return payoutAt;
  if (!payoutAt) return legacyAt;
  return new Date(legacyAt) > new Date(payoutAt) ? legacyAt : payoutAt;
}

export type DriverWalletSummary = {
  account_type: "driver";
  country_code: string;
  currency: string;
  balance_cents: number;
  available_cents: number;
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

  const [balanceCents, availableCents, pendingCents, payoutMethods, lastCashoutAt] =
    await Promise.all([
      getWalletBalance(supabaseAdmin, "driver", driverUserId, currency),
      computeDriverAvailableCents(supabaseAdmin, driverUserId),
      computeDriverPendingCents(supabaseAdmin, driverUserId),
      loadPayoutMethodsForRecipient(supabaseAdmin, countryCode, "driver"),
      resolveLastCashoutAt(supabaseAdmin, driverUserId),
    ]);

  const defaultMethod =
    payoutMethods.find((method) => method.available) ?? payoutMethods[0] ?? null;
  // Never advertise a lower minimum than the SQL cashout RPC ($20).
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
    } catch {
      // Fail closed for cashout eligibility when Stripe is unreachable.
      detailsSubmitted = false;
      chargesEnabled = false;
      payoutsEnabled = false;
      stripeOnboarded = false;
      stripeLiveVerified = false;
    }
  }

  const stripeStatus = deriveStripeConnectStatus({
    stripe_account_id: stripeAccountId,
    details_submitted: detailsSubmitted,
    charges_enabled: chargesEnabled,
    payouts_enabled: payoutsEnabled,
  });

  const cashoutBlockedCooldown = isWithinCashoutCooldown(lastCashoutAt);

  let cashoutBlockReason: string | null = null;
  if (!stripeAccountId || !stripeOnboarded) {
    cashoutBlockReason = "stripe_setup_required";
  } else if (cashoutBlockedCooldown) {
    cashoutBlockReason = "already_cashed_out_today";
  } else if (availableCents < minimumPayoutCents) {
    cashoutBlockReason = "below_minimum";
  }

  const canCashout = cashoutBlockReason === null;

  return {
    account_type: "driver",
    country_code: countryCode,
    currency,
    balance_cents: balanceCents,
    available_cents: availableCents,
    pending_cents: pendingCents,
    minimum_payout_cents: minimumPayoutCents,
    cashout_blocked_today: cashoutBlockedCooldown,
    last_cashout_at: lastCashoutAt,
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
