import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPayoutMethodsForRecipient } from "@/lib/payoutMethodRouting";
import { getWalletBalance } from "@/lib/payoutTransactionService";
import { normalizeCountryCode } from "@/lib/paymentProviderRouting";

const CURRENCY_BY_COUNTRY: Record<string, string> = {
  US: "USD",
  CA: "CAD",
  GB: "GBP",
  FR: "EUR",
  GN: "GNF",
  SN: "XOF",
  CI: "XOF",
};

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function currencyForCountry(countryCode: string): string {
  return CURRENCY_BY_COUNTRY[normalizeCountryCode(countryCode)] ?? "USD";
}

async function computeDriverAvailableCents(
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
  can_cashout: boolean;
  cashout_block_reason: string | null;
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
  const minimumPayoutCents = defaultMethod?.minimum_payout_cents ?? 2000;

  const stripeAccountId = profile?.stripe_account_id
    ? String(profile.stripe_account_id)
    : null;
  const stripeOnboarded = Boolean(profile?.stripe_onboarded);
  const cashoutBlockedToday = Boolean(
    lastCashoutAt && isSameLocalDay(new Date(lastCashoutAt), new Date())
  );

  let cashoutBlockReason: string | null = null;
  if (!stripeAccountId || !stripeOnboarded) {
    cashoutBlockReason = "stripe_setup_required";
  } else if (cashoutBlockedToday) {
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
    cashout_blocked_today: cashoutBlockedToday,
    last_cashout_at: lastCashoutAt,
    stripe_account_id: stripeAccountId,
    stripe_onboarded: stripeOnboarded,
    can_cashout: canCashout,
    cashout_block_reason: cashoutBlockReason,
  };
}
