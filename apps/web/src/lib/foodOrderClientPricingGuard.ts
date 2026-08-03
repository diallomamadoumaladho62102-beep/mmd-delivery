import {
  currencyForPlatformCountry,
  roundPlatformMoney,
  PLATFORM_CURRENCY_BY_COUNTRY,
} from "./platformCurrency";
import { getPricingBusinessDefault } from "@/lib/pricingEngine/config/businessDefaults";

/** Phase 1: from pricing business defaults (parity). */
export const FOOD_LEGACY_TAX_RATE = getPricingBusinessDefault(
  "food_legacy_tax_rate"
);

export {
  currencyForPlatformCountry,
  roundPlatformMoney as roundFoodMoney,
  PLATFORM_CURRENCY_BY_COUNTRY,
};

export const FORBIDDEN_CLIENT_FOOD_PRICING_FIELDS = [
  "subtotal",
  "tax",
  "total",
  "grand_total",
  "currency",
  "delivery_fee",
  "delivery_fee_est",
  "unit_price",
  "line_total",
  "total_cents",
  "service_fee",
  "service_fee_cents",
  "service_fee_pct",
  "service_fee_enabled",
  "service_fee_fixed_cents",
  "commission",
  "platform_amount",
] as const;

export function assertNoClientFoodPricingFields(body: Record<string, unknown>) {
  for (const key of FORBIDDEN_CLIENT_FOOD_PRICING_FIELDS) {
    if (body[key] !== undefined && body[key] !== null) {
      throw new Error(`Client-provided pricing field rejected: ${key}`);
    }
  }

  if (Array.isArray(body.items)) {
    for (const item of body.items) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      for (const key of ["unit_price", "line_total", "price", "price_cents", "currency"]) {
        if (row[key] !== undefined && row[key] !== null) {
          throw new Error(`Client-provided item pricing field rejected: ${key}`);
        }
      }
    }
  }
}
