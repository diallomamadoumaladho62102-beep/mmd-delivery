import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePaymentEntity } from "@/lib/paymentEntityResolver";
import {
  providerReturnUrl,
  providerWebhookUrl,
} from "@/lib/paymentProviderSecrets";
import { resolvePaymentMethod } from "@/lib/paymentProviderRouting";
import { getPaymentProviderAdapter } from "@/lib/paymentProviders";
import {
  createPaymentTransaction,
  updatePaymentTransaction,
} from "@/lib/paymentTransactionService";
import type { PaymentEntityType, PaymentProvider } from "@/lib/paymentTypes";

export type InitiatePaymentInput = {
  entityType: PaymentEntityType;
  entityId: string;
  methodCode: string;
  countryCode?: string | null;
  payerPhone?: string | null;
  userId: string;
};

export async function initiateLocalPayment(
  supabaseAdmin: SupabaseClient,
  input: InitiatePaymentInput
) {
  const entityResult = await resolvePaymentEntity(
    supabaseAdmin,
    input.entityType,
    input.entityId,
    input.userId,
    input.countryCode
  );
  if ("error" in entityResult) {
    return { ok: false as const, error: entityResult.error };
  }
  const entity = entityResult;

  if (String(entity.payment_status ?? "").toLowerCase() === "paid") {
    return { ok: false as const, error: "already_paid" };
  }

  const method = await resolvePaymentMethod(
    supabaseAdmin,
    entity.country_code,
    input.methodCode
  );
  if (!method) {
    return { ok: false as const, error: "payment_method_not_found" };
  }
  if (!method.client.available) {
    return {
      ok: false as const,
      error: "payment_method_unavailable",
      message: method.client.unavailable_reason,
    };
  }

  const isProd =
    process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  if (isProd && method.test_mode === true) {
    return {
      ok: false as const,
      error: "payment_method_test_mode_blocked",
      message:
        "This payment method is still in test_mode. Flip test_mode=false in admin before production use.",
    };
  }

  const provider = method.provider as PaymentProvider;
  if (provider === "stripe") {
    return { ok: false as const, error: "use_stripe_checkout_flow" };
  }

  const transaction = await createPaymentTransaction(supabaseAdmin, {
    entity,
    provider,
    methodCode: method.method_code,
    payerPhone: input.payerPhone ?? null,
    status: "pending",
  });

  const adapter = getPaymentProviderAdapter(provider);
  const initiated = await adapter.initiate({
    transactionId: transaction.id,
    amountCents: entity.amount_cents,
    currency: entity.currency,
    countryCode: entity.country_code,
    methodCode: method.method_code,
    description: `MMD ${input.entityType} ${input.entityId}`,
    payerPhone: input.payerPhone ?? null,
    returnUrl: providerReturnUrl(transaction.id),
    notifyUrl: providerWebhookUrl(provider),
    testMode: method.test_mode,
  });

  if (initiated.ok !== true) {
    await updatePaymentTransaction(supabaseAdmin, transaction.id, {
      status: "failed",
      failure_reason: initiated.error,
    });
    return { ok: false as const, error: "provider_init_failed", message: initiated.error };
  }

  const updated = await updatePaymentTransaction(supabaseAdmin, transaction.id, {
    status: initiated.status,
    external_reference: initiated.externalReference,
    payment_url: initiated.paymentUrl,
    provider_payload: initiated.payload,
  });

  return {
    ok: true as const,
    payment: updated,
    method: method.client,
  };
}
