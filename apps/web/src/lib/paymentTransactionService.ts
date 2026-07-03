import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PaymentEntityType,
  PaymentTransactionRow,
  PaymentTransactionStatus,
  ResolvedPaymentEntity,
} from "@/lib/paymentTypes";
import { entityTypeToChargeCategory } from "@/lib/payoutTypes";

export async function createPaymentTransaction(
  supabaseAdmin: SupabaseClient,
  input: {
    entity: ResolvedPaymentEntity;
    provider: string;
    methodCode: string;
    payerPhone?: string | null;
    status?: PaymentTransactionStatus;
    externalReference?: string | null;
    paymentUrl?: string | null;
    providerPayload?: Record<string, unknown>;
    expiresAt?: string | null;
  }
): Promise<PaymentTransactionRow> {
  const { data, error } = await supabaseAdmin
    .from("payment_transactions")
    .insert({
      order_id: input.entity.order_id,
      user_id: input.entity.user_id,
      entity_type: input.entity.entity_type,
      entity_id: input.entity.entity_id,
      country_code: input.entity.country_code,
      provider: input.provider,
      method_code: input.methodCode,
      amount_cents: input.entity.amount_cents,
      currency: input.entity.currency,
      charge_category: entityTypeToChargeCategory(input.entity.entity_type),
      status: input.status ?? "pending",
      external_reference: input.externalReference ?? null,
      payment_url: input.paymentUrl ?? null,
      provider_payload: input.providerPayload ?? {},
      payer_phone: input.payerPhone ?? null,
      expires_at: input.expiresAt ?? null,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "payment_transaction_create_failed");
  }

  return data as PaymentTransactionRow;
}

export async function updatePaymentTransaction(
  supabaseAdmin: SupabaseClient,
  paymentId: string,
  patch: Partial<{
    status: PaymentTransactionStatus;
    external_reference: string | null;
    payment_url: string | null;
    provider_payload: Record<string, unknown>;
    failure_reason: string | null;
    paid_at: string | null;
  }>
): Promise<PaymentTransactionRow | null> {
  const { data, error } = await supabaseAdmin
    .from("payment_transactions")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return (data as PaymentTransactionRow | null) ?? null;
}

export async function getPaymentTransactionById(
  supabaseAdmin: SupabaseClient,
  paymentId: string
): Promise<PaymentTransactionRow | null> {
  const { data, error } = await supabaseAdmin
    .from("payment_transactions")
    .select("*")
    .eq("id", paymentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PaymentTransactionRow | null) ?? null;
}

export async function getPaymentTransactionByExternalReference(
  supabaseAdmin: SupabaseClient,
  provider: string,
  externalReference: string
): Promise<PaymentTransactionRow | null> {
  const { data, error } = await supabaseAdmin
    .from("payment_transactions")
    .select("*")
    .eq("provider", provider)
    .eq("external_reference", externalReference)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PaymentTransactionRow | null) ?? null;
}

export async function recordPaymentWebhookEvent(
  supabaseAdmin: SupabaseClient,
  input: {
    provider: string;
    externalEventId: string;
    paymentTransactionId?: string | null;
    payload: Record<string, unknown>;
  }
): Promise<boolean> {
  const { error } = await supabaseAdmin.from("payment_webhook_events").insert({
    provider: input.provider,
    external_event_id: input.externalEventId,
    payment_transaction_id: input.paymentTransactionId ?? null,
    payload: input.payload,
  });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(error.message);
}

export async function findLatestOpenTransaction(
  supabaseAdmin: SupabaseClient,
  entityType: PaymentEntityType,
  entityId: string
): Promise<PaymentTransactionRow | null> {
  const { data, error } = await supabaseAdmin
    .from("payment_transactions")
    .select("*")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .in("status", ["pending", "processing", "manual_review"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PaymentTransactionRow | null) ?? null;
}
