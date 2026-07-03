import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PayoutMode,
  PayoutTransactionRow,
  PayoutTransactionStatus,
  WalletAccountType,
  WalletReferenceType,
} from "@/lib/payoutTypes";

export async function createPayoutTransaction(
  supabaseAdmin: SupabaseClient,
  input: {
    countryCode: string;
    recipientType: PayoutTransactionRow["recipient_type"];
    recipientUserId: string;
    provider: string;
    methodCode: string;
    amountCents: number;
    currency: string;
    status?: PayoutTransactionStatus;
    payoutMode?: PayoutMode;
    entityType?: string | null;
    entityId?: string | null;
    orderPayoutId?: string | null;
    grossAmountCents?: number | null;
    platformFeeCents?: number;
    netAmountCents?: number | null;
    externalReference?: string | null;
    destinationAccount?: string | null;
    providerPayload?: Record<string, unknown>;
  }
): Promise<PayoutTransactionRow> {
  const { data, error } = await supabaseAdmin
    .from("payout_transactions")
    .insert({
      country_code: input.countryCode,
      recipient_type: input.recipientType,
      recipient_user_id: input.recipientUserId,
      provider: input.provider,
      method_code: input.methodCode,
      amount_cents: input.amountCents,
      currency: input.currency,
      status: input.status ?? "pending",
      payout_mode: input.payoutMode ?? "automatic",
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      order_payout_id: input.orderPayoutId ?? null,
      gross_amount_cents: input.grossAmountCents ?? input.amountCents,
      platform_fee_cents: input.platformFeeCents ?? 0,
      net_amount_cents: input.netAmountCents ?? input.amountCents,
      external_reference: input.externalReference ?? null,
      destination_account: input.destinationAccount ?? null,
      provider_payload: input.providerPayload ?? {},
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "payout_transaction_create_failed");
  }
  return data as PayoutTransactionRow;
}

export async function updatePayoutTransactionStatus(
  supabaseAdmin: SupabaseClient,
  payoutId: string,
  status: PayoutTransactionStatus,
  patch?: {
    external_reference?: string | null;
    failure_reason?: string | null;
    provider_payload?: Record<string, unknown>;
    approved_by?: string | null;
  }
): Promise<PayoutTransactionRow> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("payout_transactions")
    .update({
      status,
      external_reference: patch?.external_reference,
      failure_reason: patch?.failure_reason ?? null,
      provider_payload: patch?.provider_payload,
      approved_at: status === "approved" ? nowIso : undefined,
      approved_by: patch?.approved_by ?? undefined,
      paid_at: status === "paid" ? nowIso : undefined,
      canceled_at: status === "canceled" ? nowIso : undefined,
      updated_at: nowIso,
    })
    .eq("id", payoutId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "payout_transaction_update_failed");
  }
  return data as PayoutTransactionRow;
}

export async function getPayoutTransactionById(
  supabaseAdmin: SupabaseClient,
  payoutId: string
): Promise<PayoutTransactionRow | null> {
  const { data, error } = await supabaseAdmin
    .from("payout_transactions")
    .select("*")
    .eq("id", payoutId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PayoutTransactionRow | null) ?? null;
}

export async function listPayoutTransactionsForUser(
  supabaseAdmin: SupabaseClient,
  userId: string,
  limit = 50
): Promise<PayoutTransactionRow[]> {
  const { data, error } = await supabaseAdmin
    .from("payout_transactions")
    .select("*")
    .eq("recipient_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as PayoutTransactionRow[];
}

export async function appendWalletLedgerEntry(
  supabaseAdmin: SupabaseClient,
  input: {
    accountType: WalletAccountType;
    accountUserId?: string | null;
    countryCode: string;
    currency: string;
    direction: "credit" | "debit";
    amountCents: number;
    referenceType: WalletReferenceType;
    referenceId: string;
    description?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const balanceAfter = await computeWalletBalanceAfter(
    supabaseAdmin,
    input.accountType,
    input.accountUserId ?? null,
    input.currency,
    input.direction,
    input.amountCents
  );

  const { data, error } = await supabaseAdmin
    .from("wallet_ledger")
    .insert({
      account_type: input.accountType,
      account_user_id: input.accountUserId ?? null,
      country_code: input.countryCode,
      currency: input.currency,
      direction: input.direction,
      amount_cents: input.amountCents,
      balance_after_cents: balanceAfter,
      reference_type: input.referenceType,
      reference_id: input.referenceId,
      description: input.description ?? null,
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "wallet_ledger_insert_failed");
  }
  return data;
}

async function computeWalletBalanceAfter(
  supabaseAdmin: SupabaseClient,
  accountType: WalletAccountType,
  accountUserId: string | null,
  currency: string,
  direction: "credit" | "debit",
  amountCents: number
): Promise<number> {
  let query = supabaseAdmin
    .from("wallet_ledger")
    .select("balance_after_cents")
    .eq("account_type", accountType)
    .eq("currency", currency)
    .order("created_at", { ascending: false })
    .limit(1);

  if (accountUserId) {
    query = query.eq("account_user_id", accountUserId);
  } else {
    query = query.is("account_user_id", null);
  }

  const { data } = await query.maybeSingle();
  const current = Number(data?.balance_after_cents ?? 0);
  return direction === "credit" ? current + amountCents : Math.max(0, current - amountCents);
}

export async function getWalletBalance(
  supabaseAdmin: SupabaseClient,
  accountType: WalletAccountType,
  accountUserId: string | null,
  currency: string
): Promise<number> {
  let query = supabaseAdmin
    .from("wallet_ledger")
    .select("balance_after_cents")
    .eq("account_type", accountType)
    .eq("currency", currency)
    .order("created_at", { ascending: false })
    .limit(1);

  if (accountUserId) query = query.eq("account_user_id", accountUserId);
  else query = query.is("account_user_id", null);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return Number(data?.balance_after_cents ?? 0);
}

export async function listWalletLedgerForUser(
  supabaseAdmin: SupabaseClient,
  accountType: WalletAccountType,
  accountUserId: string,
  limit = 50
) {
  const { data, error } = await supabaseAdmin
    .from("wallet_ledger")
    .select("*")
    .eq("account_type", accountType)
    .eq("account_user_id", accountUserId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}
