/**
 * Phase 5F — PE-owned food/package tax application (pure).
 */
import { getPricingBusinessDefault } from "../../config/businessDefaults";
import { roundMoney2 } from "./money";

export function applyFoodTax(
  taxableSubtotal: number,
  taxRatePct: number
): { tax: number; taxRatePct: number } {
  const safeSubtotal = roundMoney2(Math.max(taxableSubtotal, 0));
  const pct = Number.isFinite(taxRatePct) ? Math.max(0, taxRatePct) : 0;
  return {
    tax: roundMoney2(safeSubtotal * (pct / 100)),
    taxRatePct: roundMoney2(pct),
  };
}

/** Legacy US food tax as fraction (e.g. 0.0888) from PE business defaults. */
export function legacyUsFoodTaxFraction(): number {
  const rate = getPricingBusinessDefault("food_legacy_tax_rate");
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

export function applyLegacyUsFoodTax(taxableSubtotal: number): {
  tax: number;
  taxRatePct: number;
  taxSource: string;
} {
  const fraction = legacyUsFoodTaxFraction();
  const safeSubtotal = roundMoney2(Math.max(taxableSubtotal, 0));
  return {
    tax: roundMoney2(safeSubtotal * fraction),
    taxRatePct: roundMoney2(fraction * 100),
    taxSource: "legacy_us_food_rate",
  };
}
