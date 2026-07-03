import { getProviderSecretStatus } from "@/lib/paymentProviderSecrets";
import { normalizeCountryCode } from "@/lib/paymentProviderRouting";
import { enrichPayoutMethodForClient } from "@/lib/payoutMethodRouting";
import {
  PAYOUT_FREQUENCIES,
  PAYOUT_PROVIDERS,
  PAYOUT_RECIPIENT_TYPES,
  type PayoutFrequency,
  type PayoutMethodRow,
  type PayoutProvider,
  type PayoutRecipientType,
} from "@/lib/payoutTypes";

export const PAYOUT_METHOD_SELECT =
  "id,country_code,recipient_type,provider,method_code,display_name,description,sort_order,enabled,test_mode,auto_payout_enabled,payout_frequency,minimum_payout_cents,platform_commission_pct,created_at,updated_at";

export type AdminPayoutMethodView = PayoutMethodRow & {
  runtime_available: boolean;
  unavailable_reason: string | null;
  secrets_configured: boolean;
  secrets_missing: string[];
};

export type PayoutMethodPatchInput = {
  provider?: PayoutProvider;
  enabled?: boolean;
  test_mode?: boolean;
  display_name?: string;
  description?: string | null;
  sort_order?: number;
  auto_payout_enabled?: boolean;
  payout_frequency?: PayoutFrequency;
  minimum_payout_cents?: number;
  platform_commission_pct?: number;
};

export function buildAdminPayoutMethodView(row: PayoutMethodRow): AdminPayoutMethodView {
  const enriched = enrichPayoutMethodForClient(row);
  const provider = row.provider as PayoutProvider;
  let secretsConfigured = false;
  let secretsMissing: string[] = [];

  if (provider === "stripe_connect") {
    const status = getProviderSecretStatus("stripe");
    secretsConfigured = status.configured;
    secretsMissing = status.missing;
  } else if (provider === "bank_transfer") {
    secretsConfigured = true;
  } else if (
    provider === "orange_money_gn" ||
    provider === "paydunya" ||
    provider === "cinetpay"
  ) {
    const status = getProviderSecretStatus(provider);
    secretsConfigured = status.configured;
    secretsMissing = status.missing;
  } else if (
    provider === "wave" ||
    provider === "mtn_momo" ||
    provider === "moov_money" ||
    provider === "free_money"
  ) {
    const mapped = provider === "wave" || provider === "free_money" ? "paydunya" : "cinetpay";
    const status = getProviderSecretStatus(mapped);
    secretsConfigured = status.configured;
    secretsMissing = status.missing;
  }

  return {
    ...row,
    runtime_available: enriched.client.available,
    unavailable_reason: enriched.client.unavailable_reason,
    secrets_configured: secretsConfigured,
    secrets_missing: secretsMissing,
  };
}

export function validatePayoutMethodPatch(
  existing: PayoutMethodRow,
  patch: PayoutMethodPatchInput
): { ok: true; update: Record<string, unknown> } | { ok: false; error: string } {
  const update: Record<string, unknown> = {};

  if (patch.provider !== undefined) {
    const provider = String(patch.provider).trim().toLowerCase() as PayoutProvider;
    if (!(PAYOUT_PROVIDERS as readonly string[]).includes(provider)) {
      return { ok: false, error: "invalid_provider" };
    }
    update.provider = provider;
  }

  if (patch.enabled !== undefined) update.enabled = Boolean(patch.enabled);
  if (patch.test_mode !== undefined) update.test_mode = Boolean(patch.test_mode);
  if (patch.auto_payout_enabled !== undefined) {
    update.auto_payout_enabled = Boolean(patch.auto_payout_enabled);
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

  if (patch.payout_frequency !== undefined) {
    const frequency = String(patch.payout_frequency).trim().toLowerCase() as PayoutFrequency;
    if (!(PAYOUT_FREQUENCIES as readonly string[]).includes(frequency)) {
      return { ok: false, error: "invalid_payout_frequency" };
    }
    update.payout_frequency = frequency;
  }

  if (patch.minimum_payout_cents !== undefined) {
    const minimum = Number(patch.minimum_payout_cents);
    if (!Number.isFinite(minimum) || minimum < 0) {
      return { ok: false, error: "invalid_minimum_payout_cents" };
    }
    update.minimum_payout_cents = Math.round(minimum);
  }

  if (patch.platform_commission_pct !== undefined) {
    const pct = Number(patch.platform_commission_pct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return { ok: false, error: "invalid_platform_commission_pct" };
    }
    update.platform_commission_pct = pct;
  }

  if (Object.keys(update).length === 0) {
    return { ok: false, error: "no_changes" };
  }

  normalizeCountryCode(existing.country_code);
  return { ok: true, update };
}

export function adminPayoutMethodsPublicInfo() {
  return {
    providers: [...PAYOUT_PROVIDERS],
    recipient_types: [...PAYOUT_RECIPIENT_TYPES],
    payout_frequencies: [...PAYOUT_FREQUENCIES],
    payout_statuses: [
      "pending",
      "approved",
      "processing",
      "paid",
      "failed",
      "canceled",
    ],
  };
}
