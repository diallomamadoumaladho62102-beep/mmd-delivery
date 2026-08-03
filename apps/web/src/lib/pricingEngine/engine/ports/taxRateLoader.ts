import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyFoodTax,
  applyLegacyUsFoodTax,
} from "../compute/foodTax";
import { roundMoney2 } from "../compute/money";

function toFinite(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

/**
 * Load food tax rate (IO) + apply via PE pure tax.
 * Does not call legacy computeFoodTaxAmount.
 */
export async function loadAndApplyFoodTax(
  supabaseAdmin: SupabaseClient,
  countryCode: string,
  taxableSubtotal: number
): Promise<{ tax: number; taxRatePct: number; taxSource: string }> {
  const safeSubtotal = roundMoney2(Math.max(taxableSubtotal, 0));
  const code = String(countryCode ?? "").trim().toUpperCase();

  const { data, error } = await supabaseAdmin
    .from("taxi_country_taxes")
    .select("tax_rate, applies_to, tax_name")
    .eq("country_code", code)
    .eq("active", true)
    .eq("applies_to", "food");

  if (error) {
    console.warn("[pricingEngine.taxRateLoader] taxi_country_taxes lookup failed", error.message);
  }

  const rows = (data ?? []) as Array<{ tax_rate: number }>;
  if (rows.length > 0) {
    const taxRatePct = rows.reduce((sum, row) => sum + toFinite(row.tax_rate), 0);
    const applied = applyFoodTax(safeSubtotal, taxRatePct);
    return {
      tax: applied.tax,
      taxRatePct: applied.taxRatePct,
      taxSource: "taxi_country_taxes:food",
    };
  }

  if (code === "US") {
    return applyLegacyUsFoodTax(safeSubtotal);
  }

  return { tax: 0, taxRatePct: 0, taxSource: "none" };
}
