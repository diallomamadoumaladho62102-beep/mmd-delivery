import { normalizeTaxiCurrencyUpper } from "@/lib/taxiStripeAmounts";

export const TAXI_CHECKOUT_ALLOWED_CURRENCIES = new Set([
  "USD",
  "CAD",
  "GBP",
  "EUR",
  "GNF",
  "XOF",
  "SLE",
  "MRU",
]);

/** Production-safe taxi driver payout currencies until Connect is verified per market. */
export const TAXI_PAYOUT_ALLOWED_CURRENCIES = new Set(["USD", "CAD", "GBP", "EUR"]);

export type TaxiCurrencyGuardResult =
  | { ok: true; currency: string }
  | { ok: false; error: string; message: string; currency: string };

export function assertTaxiCheckoutCurrencyAllowed(
  currency: unknown
): TaxiCurrencyGuardResult {
  const normalized = normalizeTaxiCurrencyUpper(currency);
  if (!TAXI_CHECKOUT_ALLOWED_CURRENCIES.has(normalized)) {
    return {
      ok: false,
      error: "taxi_checkout_currency_not_supported",
      message: `Checkout currency ${normalized} is not supported for taxi`,
      currency: normalized,
    };
  }
  return { ok: true, currency: normalized };
}

export function assertTaxiPayoutCurrencyAllowed(
  currency: unknown
): TaxiCurrencyGuardResult {
  const normalized = normalizeTaxiCurrencyUpper(currency);
  if (!TAXI_PAYOUT_ALLOWED_CURRENCIES.has(normalized)) {
    return {
      ok: false,
      error: "taxi_payout_currency_not_enabled",
      message: `Taxi payout in ${normalized} is not enabled until Stripe Connect is configured for this market`,
      currency: normalized,
    };
  }
  return { ok: true, currency: normalized };
}

export function isTaxiCheckoutCurrencyAllowed(currency: unknown): boolean {
  return assertTaxiCheckoutCurrencyAllowed(currency).ok;
}

export function isTaxiPayoutCurrencyAllowed(currency: unknown): boolean {
  return assertTaxiPayoutCurrencyAllowed(currency).ok;
}
