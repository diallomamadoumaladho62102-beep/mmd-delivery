/**
 * Shared MMD manual Cash Out (Driver / Restaurant / Seller).
 *
 * Rules (founder-locked):
 * - Amount = 100% of Instant-eligible Connect balance (server only)
 * - Instant Payout ONLY → Instant-eligible debit card or Instant-eligible bank
 * - No dollar minimum (any Instant-eligible amount > 0)
 * - Max 1 manual Cash Out per America/New_York calendar day (DB atomic claim)
 * - No standard fallback (Sunday cron pays remaining available → bank)
 * - Stripe Instant payout create → local status "processing" (never "paid")
 * - "paid" / "failed" / "canceled" come from Stripe webhooks + reconciliation
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureDriverConnectManualPayoutSchedule } from "@/lib/finance/driverConnectBankPayout";
import { MONEY_OUT_MODEL } from "@/lib/finance/moneyOutArchitecture";
import { resolveManualCashoutFunding } from "@/lib/finance/resolveManualCashoutFunding";
import {
  createPayoutTransaction,
  updatePayoutTransactionStatus,
} from "@/lib/payoutTransactionService";
import { stripe } from "@/lib/stripe";
import { toUserFacingError } from "@/lib/userFacingError";

/** No Cash Out dollar minimum — Instant-eligible amount > 0 is enough. */
export const MANUAL_CASHOUT_MINIMUM_CENTS = 0;
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
      payout_method?: "instant";
      instant_eligible?: boolean;
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
      instant_block_reason?: string | null;
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

/** Eligible when Instant amount > 0 (no $20 floor). */
export function isManualCashoutAmountEligible(amountCents: number): boolean {
  return Number.isFinite(amountCents) && amountCents > MANUAL_CASHOUT_MINIMUM_CENTS;
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
  if (recipientType === "restaurant") {
    return (
      (MONEY_OUT_MODEL as { restaurantCashout?: string }).restaurantCashout ??
      MONEY_OUT_MODEL.driverCashout
    );
  }
  if (recipientType === "seller") {
    return (
      (MONEY_OUT_MODEL as { sellerCashout?: string }).sellerCashout ??
      MONEY_OUT_MODEL.driverCashout
    );
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
    (existingStatus === "paid" || existingStatus === "processing") &&
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
 * Execute Instant Cash Out (100% Instant-eligible → Instant card or Instant bank).
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

  let funding;
  try {
    funding = await resolveManualCashoutFunding(profile.stripeAccountId);
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

  const cashableCents = funding.cashableCents;

  if (
    !funding.instantEligible ||
    !funding.instantDestinationId ||
    !Number.isFinite(cashableCents) ||
    cashableCents <= 0
  ) {
    return {
      ok: false,
      error: "instant_not_eligible",
      message:
        funding.instantBlockReason === "no_instant_payout_destination" ||
        funding.instantBlockReason === "no_instant_debit_card"
          ? "Ajoutez une carte de débit Instant ou un compte bancaire admissible à Instant pour Cash Out."
          : funding.pendingCents > 0 || funding.instantAvailableCents > 0
            ? "Cash Out Instant indisponible pour le moment. Vos gains restent confirmés — paiement bancaire automatique dimanche 04:00 ET si un compte bancaire est configuré."
            : "Aucun montant Instant disponible. Attendez le paiement bancaire automatique (dimanche 04:00 ET) ou de nouveaux gains Instant-éligibles.",
      status: 400,
      payout_amount_cents: Math.max(0, cashableCents),
      currency,
      money_out_model: MONEY_OUT_MODEL,
      instant_block_reason: funding.instantBlockReason,
    };
  }

  if (!isManualCashoutAmountEligible(cashableCents)) {
    return {
      ok: false,
      error: "nothing_to_cashout",
      message: "Aucun montant Instant disponible pour Cash Out.",
      status: 400,
      payout_amount_cents: cashableCents,
      currency,
      money_out_model: MONEY_OUT_MODEL,
      instant_block_reason: funding.instantBlockReason,
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
        payout_amount_cents: cashableCents,
        currency,
        payout_transaction_id: claim.resumePaid.payoutTransactionId ?? undefined,
        money_out_model: MONEY_OUT_MODEL,
        message: "Cash out already requested today.",
        recipient_type: params.recipientType,
        recipient_user_id: params.recipientUserId,
        payout_method: "instant",
        instant_eligible: true,
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

  const amountCents = cashableCents;
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
      methodCode: "payout_stripe_connect_instant",
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
        payout_method: "instant",
        instant_destination_id: funding.instantDestinationId,
        instant_available_cents: funding.instantAvailableCents,
        available_cents: funding.availableCents,
        pending_cents: funding.pendingCents,
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
        method: "instant",
        destination: funding.instantDestinationId,
        metadata: {
          recipient_type: params.recipientType,
          recipient_user_id: params.recipientUserId,
          profile_id: profile.profileId,
          payout_transaction_id: String(audit.id),
          claim_id: claim.claimId,
          source,
          payout_method: "instant",
        },
      },
      {
        stripeAccount: profile.stripeAccountId,
        idempotencyKey: `manual-cashout:${claim.claimId}`,
      },
    );
  } catch (stripeErr) {
    await updatePayoutTransactionStatus(params.supabaseAdmin, audit.id, "failed", {
      failure_reason: toUserFacingError(
        stripeErr,
        "Stripe Instant payout create failed",
      ),
    });
    const stripeCode = String(
      (stripeErr as { code?: unknown })?.code ??
        (stripeErr as { raw?: { code?: unknown } })?.raw?.code ??
        "",
    ).toLowerCase();
    const clearEligibilityFailure = [
      "instant_payouts_unsupported",
      "method_unsupported",
      "payouts_not_allowed",
    ].includes(stripeCode);
    await finalizeClaim(params.supabaseAdmin, {
      claimId: claim.claimId,
      status: clearEligibilityFailure ? "released" : "failed",
      payoutTransactionId: audit.id,
      amountCents,
      failureReason: toUserFacingError(
        stripeErr,
        "Stripe Instant payout create failed",
      ),
    });
    throw stripeErr;
  }

  // NEVER mark paid here — wait for payout.paid / reconciliation.
  await updatePayoutTransactionStatus(params.supabaseAdmin, audit.id, "processing", {
    external_reference: payout.id,
    provider_payload: {
      source,
      claim_id: claim.claimId,
      stripe_payout_id: payout.id,
      money_out_model: moneyOutKey(params.recipientType),
      et_date: etDate,
      payout_method: "instant",
      destination: funding.instantDestinationId,
      stripe_status: payout.status,
      amount_cents: Number(payout.amount ?? amountCents),
    },
  });

  const processingAmountCents = Number(payout.amount ?? amountCents);

  await finalizeClaim(params.supabaseAdmin, {
    claimId: claim.claimId,
    status: "processing",
    payoutTransactionId: audit.id,
    stripePayoutId: payout.id,
    amountCents: processingAmountCents,
  });

  return {
    ok: true,
    stripe_payout_id: payout.id,
    payout_amount_cents: processingAmountCents,
    currency,
    payout_transaction_id: audit.id,
    claim_id: claim.claimId,
    money_out_model: MONEY_OUT_MODEL,
    message:
      "Instant Cash Out requested. Status will update to Paid when Stripe confirms the debit-card payout.",
    recipient_type: params.recipientType,
    recipient_user_id: params.recipientUserId,
    payout_method: "instant",
    instant_eligible: true,
  };
}
