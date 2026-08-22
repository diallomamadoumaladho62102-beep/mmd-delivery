import type { SupabaseClient } from "@supabase/supabase-js";
import { PRICING_BUSINESS_DEFAULTS } from "@/lib/pricingEngine/config/businessDefaults";

const AFRICA_COUNTRIES = new Set(["GN", "SN", "CI", "ML", "SL", "MR"]);

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Server-side errand subtotal — never trust client-provided amounts.
 * Uses active pricing_config minimums, then business default min fare.
 */
export async function resolveErrandServerSubtotal(
  supabaseAdmin: SupabaseClient,
  countryCode: string,
): Promise<number> {
  const country = String(countryCode || "US").trim().toUpperCase();
  const configKey = AFRICA_COUNTRIES.has(country) ? "errand_africa" : "errand_default";

  const { data } = await supabaseAdmin
    .from("pricing_config")
    .select("delivery_fee_base, minimum_order_amount, fixed_client_fee")
    .eq("config_key", configKey)
    .eq("active", true)
    .maybeSingle();

  const fromConfig = Math.max(
    Number(data?.delivery_fee_base ?? 0),
    Number(data?.minimum_order_amount ?? 0),
    Number(data?.fixed_client_fee ?? 0),
  );

  if (fromConfig > 0) {
    return roundMoney(fromConfig);
  }

  return roundMoney(PRICING_BUSINESS_DEFAULTS.delivery_min_fare);
}
