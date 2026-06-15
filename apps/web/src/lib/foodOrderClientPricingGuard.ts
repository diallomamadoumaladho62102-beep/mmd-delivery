import {
  currencyForPlatformCountry,
  roundPlatformMoney,
  PLATFORM_CURRENCY_BY_COUNTRY,
} from "./platformCurrency";

export const FOOD_LEGACY_TAX_RATE = 0.0888;

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
