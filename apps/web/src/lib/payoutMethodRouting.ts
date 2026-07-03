import type { SupabaseClient } from "@supabase/supabase-js";
import { getProviderSecretStatus } from "@/lib/paymentProviderSecrets";
import { normalizeCountryCode } from "@/lib/paymentProviderRouting";
import type {
  PayoutMethodClientView,
  PayoutMethodRow,
  PayoutProvider,
  PayoutRecipientType,
} from "@/lib/payoutTypes";

const UNAVAILABLE = "Payout method temporarily unavailable";

function payoutProviderConfigured(provider: PayoutProvider): boolean {
  if (provider === "stripe_connect") {
    return getProviderSecretStatus("stripe").configured;
  }
  if (provider === "bank_transfer") {
    return true;
  }
  if (
    provider === "orange_money_gn" ||
    provider === "paydunya" ||
    provider === "cinetpay" ||
    provider === "wave" ||
    provider === "mtn_momo" ||
    provider === "moov_money" ||
    provider === "free_money"
  ) {
    const mapped =
      provider === "wave" ||
      provider === "mtn_momo" ||
      provider === "moov_money" ||
      provider === "free_money"
        ? provider === "wave" || provider === "free_money"
          ? "paydunya"
          : "cinetpay"
        : provider;
    if (mapped === "orange_money_gn" || mapped === "paydunya" || mapped === "cinetpay") {
      return getProviderSecretStatus(mapped).configured;
    }
  }
  return false;
}

export function enrichPayoutMethodForClient(row: PayoutMethodRow): PayoutMethodRow & {
  client: PayoutMethodClientView;
} {
  const provider = row.provider as PayoutProvider;
  const available = row.enabled && payoutProviderConfigured(provider);

  return {
    ...row,
    client: {
      method_code: row.method_code,
      provider,
      display_name: row.display_name,
      description: row.description,
      test_mode: row.test_mode,
      auto_payout_enabled: row.auto_payout_enabled,
      payout_frequency: row.payout_frequency,
      minimum_payout_cents: row.minimum_payout_cents,
      available,
      unavailable_reason: available ? null : UNAVAILABLE,
      sort_order: row.sort_order,
    },
  };
}

export async function loadPayoutMethodsForRecipient(
  supabaseAdmin: SupabaseClient,
  countryCode: string,
  recipientType: PayoutRecipientType
): Promise<PayoutMethodClientView[]> {
  const code = normalizeCountryCode(countryCode);
  const { data, error } = await supabaseAdmin
    .from("payout_methods")
    .select(
      "id,country_code,recipient_type,provider,method_code,display_name,description,sort_order,enabled,test_mode,auto_payout_enabled,payout_frequency,minimum_payout_cents,platform_commission_pct,created_at,updated_at"
    )
    .eq("country_code", code)
    .eq("recipient_type", recipientType)
    .eq("enabled", true)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => enrichPayoutMethodForClient(row as PayoutMethodRow).client);
}

export async function resolveDefaultPayoutMethod(
  supabaseAdmin: SupabaseClient,
  countryCode: string,
  recipientType: PayoutRecipientType
): Promise<(PayoutMethodRow & { client: PayoutMethodClientView }) | null> {
  const code = normalizeCountryCode(countryCode);
  const { data, error } = await supabaseAdmin
    .from("payout_methods")
    .select(
      "id,country_code,recipient_type,provider,method_code,display_name,description,sort_order,enabled,test_mode,auto_payout_enabled,payout_frequency,minimum_payout_cents,platform_commission_pct,created_at,updated_at"
    )
    .eq("country_code", code)
    .eq("recipient_type", recipientType)
    .eq("enabled", true)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((row) => enrichPayoutMethodForClient(row as PayoutMethodRow));
  return rows.find((row) => row.client.available) ?? rows[0] ?? null;
}
