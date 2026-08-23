/**
 * Shared MMD manual Cash Out (Driver / Restaurant / Seller).
 *
 * Rules:
 * - Amount = Stripe Connect available balance only (never client-supplied)
 * - Minimum $20 (2000 cents)
 * - Max 1 manual cash out per America/New_York calendar day (DB atomic claim)
 * - Connect must be ready (details_submitted + charges_enabled + payouts_enabled)
 * - Destination acct_ always loaded server-side from the recipient's own profile
 * - Stripe idempotency key = manual-cashout:{claim_id}
 * - Sunday bank cron remains separate and only pays remaining Connect available
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchConnectUsdBalanceCents } from "@/lib/finance/connectUsdBalance";
import { ensureDriverConnectManualPayoutSchedule } from "@/lib/finance/driverConnectBankPayout";
import { MONEY_OUT_MODEL } from "@/lib/finance/moneyOutArchitecture";
import {
  createPayoutTransaction,
  updatePayoutTransactionStatus,
} from "@/lib/payoutTransactionService";
import { getPricingBusinessDefault } from "@/lib/pricingEngine/config/businessDefaults";
import { stripe } from "@/lib/stripe";
import { toUserFacingError } from "@/lib/userFacingError";

export const MANUAL_CASHOUT_MINIMUM_CENTS = getPricingBusinessDefault(
  "driver_cashout_minimum_cents",
);
export const MANUAL_CASHOUT_TIMEZONE = "America/New_York";

export type ManualCashoutRecipientType = "driver" | "restaurant" | "seller";

export type ManualCashoutResult =
  | {
      ok: true;
      stripe_payout_id: string | null;
      payout_amount_cents: number;
      currency: string;
      payout_transaction_id?: string;
      claim_id?: string;
      money_out_model: typeof MONEY_OUT_MODEL;
      message: string;
      recipient_type: ManualCashoutRecipientType;
      recipient_user_id: string;
    }
  | {
      ok: false;
      error: string;
      message?: string;
      status: number;
      payout_amount_cents?: number;
      currency?: string;
      last_cashout_at?: string | null;
      money_out_model?: typeof MONEY_OUT_MODEL;
    };

type ConnectProfile = {
  profileId: string;
  stripeAccountId: string;
  stripeOnboarded: boolean | null;
};

/** YYYY-MM-DD in America/New_York (DST-aware). */
export function americaNewYorkDateKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MANUAL_CASHOUT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isManualCashoutAmountEligible(amountCents: number): boolean {
  return Number.isFinite(amountCents) && amountCents >= MANUAL_CASHOUT_MINIMUM_CENTS;
}

/** True when an active manual cash out claim exists for today (America/New_York). */
export async function isManualCashoutBlockedToday(
  supabaseAdmin: SupabaseClient,
  recipientType: ManualCashoutRecipientType,
  userId: string,
): Promise<{ blocked: boolean; lastCashoutAt: string | null }> {
  const etDate = americaNewYorkDateKey();
  const { data, error } = await supabaseAdmin
    .from("manual_cashout_daily_claims")
    .select("created_at, status")
    .eq("recipient_type", recipientType)
    .eq("recipient_user_id", userId)
    .eq("et_date", etDate)
    .in("status", ["claimed", "processing", "paid"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "42P01") {
    throw new Error(error.message);
  }
  if (!data) return { blocked: false, lastCashoutAt: null };
  return {
    blocked: true,
    lastCashoutAt: data.created_at ? String(data.created_at) : null,
  };
}

function moneyOutKey(recipientType: ManualCashoutRecipientType): string {
  const model = MONEY_OUT_MODEL as Record<string, string>;
  if (recipientType === "restaurant") {
    return model.restaurantCashout ?? MONEY_OUT_MODEL.driverCashout;
  }
  if (recipientType === "seller") {
    return model.sellerCashout ?? MONEY_OUT_MODEL.driverCashout;
  }
  return MONEY_OUT_MODEL.driverCashout;
}

async function loadConnectProfile(
  supabaseAdmin: SupabaseClient,
  recipientType: ManualCashoutRecipientType,
  userId: string,
): Promise<ConnectProfile | { error: string; status: number; message?: string }> {
  if (recipientType === "driver") {
    const { data, error } = await supabaseAdmin
      .from("driver_profiles")
      .select("id, user_id, stripe_account_id, stripe_onboarded")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return { error: error.message, status: 400 };
    if (!data) return { error: "Driver profile not found", status: 404 };
    if (!data.stripe_account_id) {
      return {
        error: "stripe_setup_required",
        status: 400,
        message: "Aucun compte Stripe Connect trouvé.",
      };
    }
    return {
      profileId: String(data.id),
      stripeAccountId: String(data.stripe_account_id),
      stripeOnboarded:
        data.stripe_onboarded === null || data.stripe_onboarded === undefined
          ? null
          : Boolean(data.stripe_onboarded),
    };
  }

  if (recipientType === "restaurant") {
    const { data, error } = await supabaseAdmin
      .from("restaurant_profiles")
      .select("id, user_id, stripe_account_id, stripe_onboarded")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return { error: error.message, status: 400 };
    if (!data) return { error: "Restaurant profile not found", status: 404 };
    if (!data.stripe_account_id) {
      return {
        error: "stripe_setup_required",
        status: 400,
        message: "Aucun compte Stripe Connect restaurant trouvé.",
      };
    }
    return {
      profileId: String(data.id),
      stripeAccountId: String(data.stripe_account_id),
      stripeOnboarded:
        data.stripe_onboarded === null || data.stripe_onboarded === undefined
          ? null
          : Boolean(data.stripe_onboarded),
    };
  }

  const { data, error } = await supabaseAdmin
    .from("sellers")
    .select("id, user_id, stripe_account_id, stripe_onboarding_status")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) return { error: error.message, status: 400 };
  if (!data) return { error: "Seller profile not found", status: 404 };
  if (!data.stripe_account_id) {
    return {
      error: "stripe_setup_required",
      status: 400,
      message: "Aucun compte Stripe Connect seller trouvé.",
    };
  }
  return {
    profileId: String(data.id),
    stripeAccountId: String(data.stripe_account_id),
    stripeOnboarded: String(data.stripe_onboarding_status ?? "")
      .toLowerCase()
      .includes("complete"),
  };
}

async function claimDailySlot(
  supabaseAdmin: SupabaseClient,
  recipientType: ManualCashoutRecipientType,
  userId: string,
  etDate: string,
): Promise<
  | { ok: true; claimId: string }
  | {
      ok: false;
      error: string;
      status: number;
      lastCashoutAt?: string | null;
      resumePaid?: {
        stripePayoutId: string | null;
        payoutTransactionId: string | null;
      };
    }
> {
  const { data, error } = await supabaseAdmin.rpc("claim_manual_cashout_day", {
    p_recipient_type: recipientType,
    p_recipient_user_id: userId,
    p_et_date: etDate,
  });

  if (error) {
    return { ok: false, error: error.message, status: 500 };
  }

  const payload = (data ?? {}) as Record<string, unknown>;
  if (payload.ok === true && payload.claim_id) {
    return { ok: true, claimId: String(payload.claim_id) };
  }

  const existingStatus = String(payload.status ?? "");
  if (
    existingStatus === "paid" &&
    (payload.stripe_payout_id || payload.payout_transaction_id)
  ) {
    return {
      ok: false,
      error: "cashout_rate_limited",
      status: 429,
      lastCashoutAt: payload.created_at ? String(payload.created_at) : null,
      resumePaid: {
        stripePayoutId: payload.stripe_payout_id
          ? String(payload.stripe_payout_id)
          : null,
        payoutTransactionId: payload.payout_transaction_id
          ? String(payload.payout_transaction_id)
          : null,
      },
    };
  }

  return {
    ok: false,
    error: "cashout_rate_limited",
    status: 429,
    lastCashoutAt: payload.created_at ? String(payload.created_at) : null,
  };
}

async function finalizeClaim(
  supabaseAdmin: SupabaseClient,
  input: {
    claimId: string;
    status: "processing" | "paid" | "failed" | "released";
    payoutTransactionId?: string | null;
    stripePayoutId?: string | null;
    amountCents?: number | null;
    failureReason?: string | null;
  },
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("finalize_manual_cashout_day", {
    p_claim_id: input.claimId,
    p_status: input.status,
    p_payout_transaction_id: input.payoutTransactionId ?? null,
    p_stripe_payout_id: input.stripePayoutId ?? null,
    p_amount_cents: input.amountCents ?? null,
    p_failure_reason: input.failureReason ?? null,
  });
  if (error) {
    console.error("[manualCashout] finalize_manual_cashout_day failed", error.message);
  }
}

/**
 * Execute one manual Connect → bank Cash Out for the authenticated recipient.
 * Never trusts client amount / stripe account / foreign ids.
 */
export async function executeManualConnectCashout(params: {
  supabaseAdmin: SupabaseClient;
  recipientType: ManualCashoutRecipientType;
  recipientUserId: string;
  currency?: string;
  source?: string;
}): Promise<ManualCashoutResult> {
  const currency = String(params.currency ?? "USD").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, error: "Invalid currency", status: 400 };
  }
  if (currency !== "USD") {
    return { ok: false, error: "Unsupported currency", status: 400 };
  }

  const source =
    String(params.source ?? "mobile_wallet_cashout").trim() ||
    "mobile_wallet_cashout";

  const profile = await loadConnectProfile(
    params.supabaseAdmin,
    params.recipientType,
    params.recipientUserId,
  );
  if ("error" in profile) {
    return {
      ok: false,
      error: profile.error,
      message: profile.message,
      status: profile.status,
      money_out_model: MONEY_OUT_MODEL,
    };
  }

  if (profile.stripeOnboarded === false) {
    return {
      ok: false,
      error: "stripe_setup_required",
      message: "Complétez la configuration Stripe pour activer les virements.",
      status: 400,
      money_out_model: MONEY_OUT_MODEL,
    };
  }

  try {
    const connectAccount = await stripe.accounts.retrieve(profile.stripeAccountId);
    if (
      !connectAccount.details_submitted ||
      !connectAccount.charges_enabled ||
      !connectAccount.payouts_enabled
    ) {
      return {
        ok: false,
        error: "stripe_setup_required",
        message:
          "Votre compte Stripe n'est pas encore prêt pour les virements. Terminez la vérification, puis réessayez.",
        status: 400,
        money_out_model: MONEY_OUT_MODEL,
      };
    }
  } catch (connectErr) {
    return {
      ok: false,
      error: "stripe_account_lookup_failed",
      message: toUserFacingError(
        connectErr,
        "Impossible de vérifier le compte Stripe. Réessayez dans quelques instants.",
      ),
      status: 400,
      money_out_model: MONEY_OUT_MODEL,
    };
  }

  await ensureDriverConnectManualPayoutSchedule(profile.stripeAccountId);

  let availableCents = 0;
  try {
    const balance = await fetchConnectUsdBalanceCents(profile.stripeAccountId);
    availableCents = balance.availableCents;
  } catch (balanceErr) {
    return {
      ok: false,
      error: "stripe_balance_lookup_failed",
      message: toUserFacingError(
        balanceErr,
        "Impossible de lire le solde Stripe. Réessayez dans quelques instants.",
      ),
      status: 400,
      money_out_model: MONEY_OUT_MODEL,
    };
  }

  if (!Number.isFinite(availableCents) || availableCents <= 0) {
    return {
      ok: true,
      stripe_payout_id: null,
      payout_amount_cents: 0,
      currency,
      money_out_model: MONEY_OUT_MODEL,
      message:
        "Nothing to pay — Connect available balance is empty. Unpaid earnings await SCT transfer.",
      recipient_type: params.recipientType,
      recipient_user_id: params.recipientUserId,
    };
  }

  if (!isManualCashoutAmountEligible(availableCents)) {
    return {
      ok: false,
      error: "below_minimum",
      message: `Minimum cash out is ${MANUAL_CASHOUT_MINIMUM_CENTS} cents.`,
      status: 400,
      payout_amount_cents: availableCents,
      currency,
      money_out_model: MONEY_OUT_MODEL,
    };
  }

  const etDate = americaNewYorkDateKey();
  const claim = await claimDailySlot(
    params.supabaseAdmin,
    params.recipientType,
    params.recipientUserId,
    etDate,
  );

  if (claim.ok === false) {
    if (claim.resumePaid?.stripePayoutId) {
      return {
        ok: true,
        stripe_payout_id: claim.resumePaid.stripePayoutId,
        payout_amount_cents: availableCents,
        currency,
        payout_transaction_id: claim.resumePaid.payoutTransactionId ?? undefined,
        money_out_model: MONEY_OUT_MODEL,
        message: "Cash out already completed today.",
        recipient_type: params.recipientType,
        recipient_user_id: params.recipientUserId,
      };
    }
    return {
      ok: false,
      error: claim.error,
      message:
        "Vous avez déjà demandé un cash out aujourd'hui. Réessayez demain.",
      status: claim.status,
      last_cashout_at: claim.lastCashoutAt ?? null,
      money_out_model: MONEY_OUT_MODEL,
    };
  }

  const amountCents = availableCents;
  await finalizeClaim(params.supabaseAdmin, {
    claimId: claim.claimId,
    status: "processing",
    amountCents,
  });

  let audit;
  try {
    audit = await createPayoutTransaction(params.supabaseAdmin, {
      countryCode: "US",
      recipientType: params.recipientType,
      recipientUserId: params.recipientUserId,
      provider: "stripe_connect",
      methodCode: "payout_stripe_connect",
      amountCents,
      currency,
      status: "processing",
      payoutMode: "manual",
      destinationAccount: profile.stripeAccountId,
      providerPayload: {
        source,
        claim_id: claim.claimId,
        money_out_model: moneyOutKey(params.recipientType),
        et_date: etDate,
      },
    });
  } catch (ledgerErr) {
    await finalizeClaim(params.supabaseAdmin, {
      claimId: claim.claimId,
      status: "released",
      failureReason: toUserFacingError(ledgerErr, "payout_transaction_create_failed"),
    });
    throw ledgerErr;
  }

  await finalizeClaim(params.supabaseAdmin, {
    claimId: claim.claimId,
    status: "processing",
    payoutTransactionId: audit.id,
    amountCents,
  });

  let payout;
  try {
    payout = await stripe.payouts.create(
      {
        amount: amountCents,
        currency: currency.toLowerCase(),
        metadata: {
          recipient_type: params.recipientType,
          recipient_user_id: params.recipientUserId,
          profile_id: profile.profileId,
          payout_transaction_id: String(audit.id),
          claim_id: claim.claimId,
          source,
        },
      },
      {
        stripeAccount: profile.stripeAccountId,
        idempotencyKey: `manual-cashout:${claim.claimId}`,
      },
    );
  } catch (stripeErr) {
    await updatePayoutTransactionStatus(params.supabaseAdmin, audit.id, "failed", {
      failure_reason: toUserFacingError(stripeErr, "Stripe payout create failed"),
    });
    await finalizeClaim(params.supabaseAdmin, {
      claimId: claim.claimId,
      status: "released",
      payoutTransactionId: audit.id,
      amountCents,
      failureReason: toUserFacingError(stripeErr, "Stripe payout create failed"),
    });
    throw stripeErr;
  }

  await updatePayoutTransactionStatus(params.supabaseAdmin, audit.id, "paid", {
    external_reference: payout.id,
    provider_payload: {
      source,
      claim_id: claim.claimId,
      stripe_payout_id: payout.id,
      money_out_model: moneyOutKey(params.recipientType),
      et_date: etDate,
    },
  });

  await finalizeClaim(params.supabaseAdmin, {
    claimId: claim.claimId,
    status: "paid",
    payoutTransactionId: audit.id,
    stripePayoutId: payout.id,
    amountCents,
  });

  return {
    ok: true,
    stripe_payout_id: payout.id,
    payout_amount_cents: amountCents,
    currency,
    payout_transaction_id: audit.id,
    claim_id: claim.claimId,
    money_out_model: MONEY_OUT_MODEL,
    message: "Connect available balance payout created.",
    recipient_type: params.recipientType,
    recipient_user_id: params.recipientUserId,
  };
}
