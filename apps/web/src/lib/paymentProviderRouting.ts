import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getProviderSecretStatus,
  isStripeExplicitlyEnabledForGuinea,
} from "@/lib/paymentProviderSecrets";
import type {
  PaymentMethodClientView,
  PaymentMethodRow,
  PaymentProvider,
} from "@/lib/paymentTypes";

const UNAVAILABLE_MESSAGE = "Payment method temporarily unavailable";

export function normalizeCountryCode(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .slice(0, 2);
}

export function isStripeBlockedForCountry(countryCode: string, methodEnabled: boolean): boolean {
  if (countryCode !== "GN") return false;
  if (!methodEnabled) return true;
  return !isStripeExplicitlyEnabledForGuinea();
}

export function enrichPaymentMethodForClient(row: PaymentMethodRow): PaymentMethodRow & {
  client: PaymentMethodClientView;
} {
  const provider = row.provider as PaymentProvider;
  const secretStatus = getProviderSecretStatus(provider);
  let available = row.enabled && secretStatus.configured;

  if (provider === "stripe" && isStripeBlockedForCountry(row.country_code, row.enabled)) {
    available = false;
  }

  const client: PaymentMethodClientView = {
    method_code: row.method_code,
    provider,
    display_name: row.display_name,
    description: row.description,
    test_mode: row.test_mode,
    available,
    unavailable_reason: available ? null : UNAVAILABLE_MESSAGE,
    sort_order: row.sort_order,
  };

  return { ...row, client };
}

export async function loadPaymentMethodsForCountry(
  supabaseAdmin: SupabaseClient,
  countryCode: string
): Promise<PaymentMethodClientView[]> {
  const code = normalizeCountryCode(countryCode);
  const { data, error } = await supabaseAdmin
    .from("payment_methods")
    .select(
      "id,country_code,provider,method_code,display_name,description,sort_order,enabled,test_mode"
    )
    .eq("country_code", code)
    .eq("enabled", true)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => enrichPaymentMethodForClient(row as PaymentMethodRow).client);
}

export async function resolvePaymentMethod(
  supabaseAdmin: SupabaseClient,
  countryCode: string,
  methodCode: string
): Promise<(PaymentMethodRow & { client: PaymentMethodClientView }) | null> {
  const code = normalizeCountryCode(countryCode);
  const { data, error } = await supabaseAdmin
    .from("payment_methods")
    .select(
      "id,country_code,provider,method_code,display_name,description,sort_order,enabled,test_mode"
    )
    .eq("country_code", code)
    .eq("method_code", methodCode)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) return null;
  return enrichPaymentMethodForClient(data as PaymentMethodRow);
}

export function assertStripeCheckoutAllowed(countryCode: string): { ok: true } | { ok: false; message: string } {
  const code = normalizeCountryCode(countryCode);
  if (isStripeBlockedForCountry(code, true)) {
    return {
      ok: false,
      message:
        "Stripe checkout is disabled for Guinea. Use Orange Money or another local payment method.",
    };
  }
  return { ok: true };
}

export function defaultProviderForCountry(countryCode: string): PaymentProvider {
  switch (normalizeCountryCode(countryCode)) {
    case "GN":
      return "orange_money_gn";
    case "SN":
      return "paydunya";
    case "CI":
      return "cinetpay";
    default:
      return "stripe";
  }
}

export function usesLocalMobileMoney(countryCode: string): boolean {
  return ["GN", "SN", "CI"].includes(normalizeCountryCode(countryCode));
}
