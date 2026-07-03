import {
  getProviderSecretStatus,
  isStripeExplicitlyEnabledForGuinea,
  paymentsPublicBaseUrl,
  providerWebhookUrl,
} from "@/lib/paymentProviderSecrets";
import { enrichPaymentMethodForClient, normalizeCountryCode } from "@/lib/paymentProviderRouting";
import {
  PAYMENT_PROVIDERS,
  type PaymentMethodRow,
  type PaymentProvider,
} from "@/lib/paymentTypes";

export const PAYMENT_METHOD_SELECT =
  "id,country_code,provider,method_code,display_name,description,sort_order,enabled,test_mode,created_at,updated_at";

export type AdminPaymentMethodView = PaymentMethodRow & {
  runtime_available: boolean;
  unavailable_reason: string | null;
  secrets_configured: boolean;
  secrets_missing: string[];
  stripe_gn_env_enabled: boolean;
  webhook_url: string | null;
};

export type PaymentMethodPatchInput = {
  provider?: PaymentProvider;
  enabled?: boolean;
  test_mode?: boolean;
  display_name?: string;
  description?: string | null;
  sort_order?: number;
};

export function buildAdminPaymentMethodView(row: PaymentMethodRow): AdminPaymentMethodView {
  const enriched = enrichPaymentMethodForClient(row);
  const secretStatus = getProviderSecretStatus(row.provider as PaymentProvider);
  const provider = row.provider as PaymentProvider;

  return {
    ...row,
    runtime_available: enriched.client.available,
    unavailable_reason: enriched.client.unavailable_reason,
    secrets_configured: secretStatus.configured,
    secrets_missing: secretStatus.missing,
    stripe_gn_env_enabled: isStripeExplicitlyEnabledForGuinea(),
    webhook_url:
      provider === "stripe" ? null : providerWebhookUrl(provider),
  };
}

export function validatePaymentMethodPatch(
  existing: PaymentMethodRow,
  patch: PaymentMethodPatchInput
): { ok: true; update: Record<string, unknown> } | { ok: false; error: string } {
  const update: Record<string, unknown> = {};

  if (patch.provider !== undefined) {
    const provider = String(patch.provider).trim().toLowerCase() as PaymentProvider;
    if (!(PAYMENT_PROVIDERS as readonly string[]).includes(provider)) {
      return { ok: false, error: "invalid_provider" };
    }
    update.provider = provider;
  }

  if (patch.enabled !== undefined) {
    update.enabled = Boolean(patch.enabled);
  }

  if (patch.test_mode !== undefined) {
    update.test_mode = Boolean(patch.test_mode);
  }

  if (patch.display_name !== undefined) {
    const name = String(patch.display_name).trim();
    if (!name) return { ok: false, error: "display_name_required" };
    update.display_name = name;
  }

  if (patch.description !== undefined) {
    update.description =
      patch.description == null ? null : String(patch.description).trim() || null;
  }

  if (patch.sort_order !== undefined) {
    const sortOrder = Number(patch.sort_order);
    if (!Number.isFinite(sortOrder)) return { ok: false, error: "invalid_sort_order" };
    update.sort_order = Math.round(sortOrder);
  }

  const nextProvider = (update.provider as PaymentProvider | undefined) ?? (existing.provider as PaymentProvider);
  const nextEnabled =
    update.enabled !== undefined ? Boolean(update.enabled) : existing.enabled;
  const countryCode = normalizeCountryCode(existing.country_code);

  if (countryCode === "GN" && nextProvider === "stripe" && nextEnabled) {
    if (!isStripeExplicitlyEnabledForGuinea()) {
      return {
        ok: false,
        error:
          "Stripe cannot be enabled for Guinea until STRIPE_ENABLED_GN=true is set on the server.",
      };
    }
  }

  if (Object.keys(update).length === 0) {
    return { ok: false, error: "no_changes" };
  }

  return { ok: true, update };
}

export function adminPaymentMethodsPublicInfo() {
  return {
    public_base_url: paymentsPublicBaseUrl(),
    stripe_gn_env_enabled: isStripeExplicitlyEnabledForGuinea(),
    providers: [...PAYMENT_PROVIDERS],
  };
}
