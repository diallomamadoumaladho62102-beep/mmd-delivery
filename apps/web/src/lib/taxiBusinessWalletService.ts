import type { SupabaseClient } from "@supabase/supabase-js";
import { getWalletBalance } from "@/lib/payoutTransactionService";
import { stripe } from "@/lib/stripe";

type LedgerDirection = "credit" | "debit";

async function insertBusinessLedger(
  supabaseAdmin: SupabaseClient,
  params: {
    businessAccountId: string;
    direction: LedgerDirection;
    amountCents: number;
    currency: string;
    referenceType:
      | "business_topup"
      | "business_ride_debit"
      | "business_payout"
      | "business_refund_credit"
      | "payment_transaction"
      | "payout_transaction"
      | "refund";
    referenceId: string;
    description: string;
    metadata?: Record<string, unknown>;
    entryType: string;
    stripePaymentIntentId?: string | null;
    stripeTransferId?: string | null;
  }
): Promise<void> {
  const amount = Math.max(0, Math.round(Number(params.amountCents)));
  if (amount <= 0) return;

  const currency = String(params.currency ?? "USD").toUpperCase();
  const countryCode = "US";

  // Prefer durable wallet_ledger; fail closed on insert error for money paths.
  const { error: ledgerErr } = await supabaseAdmin.from("wallet_ledger").insert({
    account_type: "business",
    account_user_id: params.businessAccountId,
    country_code: countryCode,
    currency,
    direction: params.direction,
    amount_cents: amount,
    reference_type: params.referenceType,
    reference_id: params.referenceId,
    description: params.description,
    metadata: {
      ...(params.metadata ?? {}),
      business_account_id: params.businessAccountId,
    },
  });

  if (ledgerErr) {
    // If constraint rejects new reference_type before migration, fall back.
    const { error: fallbackErr } = await supabaseAdmin.from("wallet_ledger").insert({
      account_type: "business",
      account_user_id: params.businessAccountId,
      country_code: countryCode,
      currency,
      direction: params.direction,
      amount_cents: amount,
      reference_type:
        params.direction === "credit" ? "payment_transaction" : "adjustment",
      reference_id: params.referenceId,
      description: params.description,
      metadata: {
        ...(params.metadata ?? {}),
        business_account_id: params.businessAccountId,
        intended_reference_type: params.referenceType,
      },
    });
    if (fallbackErr && ledgerErr) {
      throw new Error(ledgerErr.message || fallbackErr.message);
    }
  }

  await supabaseAdmin.from("taxi_business_wallet_entries").insert({
    business_account_id: params.businessAccountId,
    direction: params.direction,
    amount_cents: amount,
    currency,
    entry_type: params.entryType,
    reference_type: params.referenceType,
    reference_id: params.referenceId,
    stripe_payment_intent_id: params.stripePaymentIntentId ?? null,
    stripe_transfer_id: params.stripeTransferId ?? null,
    description: params.description,
    metadata: params.metadata ?? {},
  });
}

export async function getBusinessWalletBalance(
  supabaseAdmin: SupabaseClient,
  businessAccountId: string,
  currency = "USD"
): Promise<number> {
  try {
    return await getWalletBalance(
      supabaseAdmin,
      "business",
      businessAccountId,
      currency
    );
  } catch {
    // Fallback: sum domain entries if wallet_ledger account_type not yet migrated.
    const { data } = await supabaseAdmin
      .from("taxi_business_wallet_entries")
      .select("direction,amount_cents")
      .eq("business_account_id", businessAccountId)
      .eq("currency", String(currency).toUpperCase());

    return (data ?? []).reduce((sum, row) => {
      const amt = Math.max(0, Math.round(Number(row.amount_cents ?? 0)));
      return String(row.direction) === "credit" ? sum + amt : sum - amt;
    }, 0);
  }
}

export async function creditBusinessWalletTopup(
  supabaseAdmin: SupabaseClient,
  params: {
    businessAccountId: string;
    amountCents: number;
    currency: string;
    paymentIntentId: string;
    chargeId?: string | null;
    referenceId?: string;
  }
): Promise<{ ok: true; balance_cents: number } | { ok: false; error: string }> {
  const amount = Math.max(0, Math.round(Number(params.amountCents)));
  if (amount <= 0) return { ok: false, error: "invalid_amount" };

  // Idempotency: skip if this PI already credited.
  const { data: existing } = await supabaseAdmin
    .from("taxi_business_wallet_entries")
    .select("id")
    .eq("business_account_id", params.businessAccountId)
    .eq("stripe_payment_intent_id", params.paymentIntentId)
    .eq("entry_type", "topup")
    .maybeSingle();

  if (existing) {
    const balance = await getBusinessWalletBalance(
      supabaseAdmin,
      params.businessAccountId,
      params.currency
    );
    return { ok: true, balance_cents: balance };
  }

  const referenceId = params.referenceId;
  const refUuid = referenceId && /^[0-9a-f-]{36}$/i.test(referenceId)
    ? referenceId
    : crypto.randomUUID();

  await insertBusinessLedger(supabaseAdmin, {
    businessAccountId: params.businessAccountId,
    direction: "credit",
    amountCents: amount,
    currency: params.currency,
    referenceType: "business_topup",
    referenceId: refUuid,
    description: `Business wallet top-up ${params.paymentIntentId}`,
    entryType: "topup",
    stripePaymentIntentId: params.paymentIntentId,
    metadata: {
      stripe_charge_id: params.chargeId ?? null,
      stripe_payment_intent_id: params.paymentIntentId,
    },
  });

  // Persist last top-up charge for cash-out source_transaction preference.
  if (params.chargeId) {
    await supabaseAdmin
      .from("taxi_business_accounts")
      .update({
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.businessAccountId);
  }

  const balance = await getBusinessWalletBalance(
    supabaseAdmin,
    params.businessAccountId,
    params.currency
  );
  return { ok: true, balance_cents: balance };
}

export async function debitBusinessWalletForRide(
  supabaseAdmin: SupabaseClient,
  params: {
    businessAccountId: string;
    taxiRideId: string;
    amountCents: number;
    currency: string;
  }
): Promise<{ ok: true; balance_cents: number } | { ok: false; error: string }> {
  const amount = Math.max(0, Math.round(Number(params.amountCents)));
  if (amount <= 0) return { ok: false, error: "invalid_amount" };

  const { data: existing } = await supabaseAdmin
    .from("taxi_business_wallet_entries")
    .select("id")
    .eq("business_account_id", params.businessAccountId)
    .eq("reference_id", params.taxiRideId)
    .eq("entry_type", "ride_debit")
    .maybeSingle();

  if (existing) {
    const balance = await getBusinessWalletBalance(
      supabaseAdmin,
      params.businessAccountId,
      params.currency
    );
    return { ok: true, balance_cents: balance };
  }

  const balance = await getBusinessWalletBalance(
    supabaseAdmin,
    params.businessAccountId,
    params.currency
  );
  if (balance < amount) {
    return { ok: false, error: "insufficient_business_wallet_balance" };
  }

  await insertBusinessLedger(supabaseAdmin, {
    businessAccountId: params.businessAccountId,
    direction: "debit",
    amountCents: amount,
    currency: params.currency,
    referenceType: "business_ride_debit",
    referenceId: params.taxiRideId,
    description: `Business wallet debit for taxi ride ${params.taxiRideId}`,
    entryType: "ride_debit",
    metadata: { taxi_ride_id: params.taxiRideId },
  });

  return {
    ok: true,
    balance_cents: balance - amount,
  };
}

export async function creditBusinessWalletRefund(
  supabaseAdmin: SupabaseClient,
  params: {
    businessAccountId: string;
    taxiRideId: string;
    amountCents: number;
    currency: string;
    reason: string;
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const amount = Math.max(0, Math.round(Number(params.amountCents)));
  if (amount <= 0) return { ok: true };

  const { data: existing } = await supabaseAdmin
    .from("taxi_business_wallet_entries")
    .select("id")
    .eq("business_account_id", params.businessAccountId)
    .eq("reference_id", params.taxiRideId)
    .eq("entry_type", "ride_refund")
    .maybeSingle();

  if (existing) return { ok: true };

  await insertBusinessLedger(supabaseAdmin, {
    businessAccountId: params.businessAccountId,
    direction: "credit",
    amountCents: amount,
    currency: params.currency,
    referenceType: "business_refund_credit",
    referenceId: params.taxiRideId,
    description: `Business wallet refund (${params.reason})`,
    entryType: "ride_refund",
    metadata: { reason: params.reason, taxi_ride_id: params.taxiRideId },
  });

  // Billing event is best-effort; member_user_id requires a real auth user.
  return { ok: true };
}

/**
 * Cash-out prepaid Business Wallet surplus to the business Connect account.
 * Prefers source_transaction from a recent top-up charge when available.
 */
export async function executeBusinessWalletCashout(
  supabaseAdmin: SupabaseClient,
  params: {
    businessAccountId: string;
    amountCents: number;
    currency?: string;
  }
): Promise<
  | { ok: true; transfer_id: string; amount_cents: number }
  | { ok: false; error: string }
> {
  const amount = Math.max(0, Math.round(Number(params.amountCents)));
  if (amount <= 0) return { ok: false, error: "invalid_amount" };

  const { data: account, error: accountErr } = await supabaseAdmin
    .from("taxi_business_accounts")
    .select(
      "id,currency,stripe_account_id,stripe_payouts_enabled,stripe_charges_enabled,stripe_details_submitted"
    )
    .eq("id", params.businessAccountId)
    .maybeSingle();

  if (accountErr || !account) {
    return { ok: false, error: accountErr?.message ?? "account_not_found" };
  }

  const destination = String(account.stripe_account_id ?? "").trim();
  if (!/^acct_[A-Za-z0-9]+$/.test(destination)) {
    return { ok: false, error: "connect_not_ready" };
  }
  if (
    !account.stripe_details_submitted ||
    !account.stripe_charges_enabled ||
    !account.stripe_payouts_enabled
  ) {
    return { ok: false, error: "connect_not_ready" };
  }

  const currency = String(params.currency ?? account.currency ?? "USD");
  const balance = await getBusinessWalletBalance(
    supabaseAdmin,
    params.businessAccountId,
    currency
  );
  if (balance < amount) {
    return { ok: false, error: "insufficient_balance" };
  }

  // Prefer a recent top-up charge as source_transaction.
  const { data: topup } = await supabaseAdmin
    .from("taxi_business_wallet_entries")
    .select("metadata,stripe_payment_intent_id")
    .eq("business_account_id", params.businessAccountId)
    .eq("entry_type", "topup")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let sourceChargeId: string | null = null;
  const metaCharge = (topup?.metadata as { stripe_charge_id?: string } | null)
    ?.stripe_charge_id;
  if (metaCharge) sourceChargeId = String(metaCharge).trim();

  if (!sourceChargeId && topup?.stripe_payment_intent_id) {
    try {
      const pi = await stripe.paymentIntents.retrieve(
        String(topup.stripe_payment_intent_id)
      );
      const latest = pi.latest_charge;
      if (typeof latest === "string") sourceChargeId = latest;
      else if (latest && typeof latest === "object" && "id" in latest) {
        sourceChargeId = String((latest as { id: string }).id);
      }
    } catch {
      sourceChargeId = null;
    }
  }

  if (!sourceChargeId) {
    return { ok: false, error: "missing_source_charge_for_cashout" };
  }

  const transfer = await stripe.transfers.create(
    {
      amount,
      currency: currency.toLowerCase(),
      destination,
      source_transaction: sourceChargeId,
      metadata: {
        business_account_id: params.businessAccountId,
        source: "business_wallet_cashout",
      },
    },
    {
      idempotencyKey: `biz_cashout_${params.businessAccountId}_${amount}_${sourceChargeId}`,
    }
  );

  await insertBusinessLedger(supabaseAdmin, {
    businessAccountId: params.businessAccountId,
    direction: "debit",
    amountCents: amount,
    currency,
    referenceType: "business_payout",
    referenceId: crypto.randomUUID(),
    description: `Business wallet cash-out ${transfer.id}`,
    entryType: "cashout",
    stripeTransferId: transfer.id,
    metadata: { stripe_transfer_id: transfer.id, source_charge: sourceChargeId },
  });

  return { ok: true, transfer_id: transfer.id, amount_cents: amount };
}
