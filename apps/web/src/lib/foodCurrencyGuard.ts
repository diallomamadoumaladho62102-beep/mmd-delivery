import {
  assertTaxiCheckoutCurrencyAllowed,
  TAXI_CHECKOUT_ALLOWED_CURRENCIES,
} from "@/lib/taxiCurrencyGuard";
import {
  alignTaxiAmountCentsForZeroDecimal,
  toStripeAmount,
} from "@/lib/taxiStripeAmounts";

export const FOOD_CHECKOUT_ALLOWED_CURRENCIES = TAXI_CHECKOUT_ALLOWED_CURRENCIES;

export type FoodCurrencyGuardResult =
  | { ok: true; currency: string }
  | { ok: false; error: string; message: string; currency: string };

export function assertFoodCheckoutCurrencyAllowed(
  currency: unknown
): FoodCurrencyGuardResult {
  return assertTaxiCheckoutCurrencyAllowed(currency);
}

export function safeFoodCheckoutCurrency(value: unknown): string {
  const result = assertFoodCheckoutCurrencyAllowed(value);
  return result.ok ? result.currency.toLowerCase() : "usd";
}

export function foodAmountCentsForStripe(
  currency: unknown,
  amountCents: unknown
): number {
  return alignTaxiAmountCentsForZeroDecimal(currency, amountCents);
}

export function foodStripeUnitAmount(
  currency: unknown,
  amountCents: unknown
): number {
  const aligned = foodAmountCentsForStripe(currency, amountCents);
  return toStripeAmount(currency, aligned);
}
