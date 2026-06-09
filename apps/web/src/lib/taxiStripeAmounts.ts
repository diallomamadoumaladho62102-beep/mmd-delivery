import { normalizeTaxiCurrencyCode } from "@/lib/taxiCountries";

/** ISO 4217 codes billed in whole units on Stripe (no ×100). */
export const TAXI_ZERO_DECIMAL_CURRENCIES = new Set(["GNF", "XOF"]);

/** Decimal currencies for taxi (internal storage always uses amount_cents = major×100). */
export const TAXI_DECIMAL_CURRENCIES = new Set([
  "USD",
  "CAD",
  "GBP",
  "EUR",
  "SLE",
  "MRU",
]);

export function normalizeTaxiCurrencyUpper(value: unknown, fallback = "USD"): string {
  return normalizeTaxiCurrencyCode(value, fallback);
}

export function isZeroDecimalTaxiCurrency(currency: unknown): boolean {
  return TAXI_ZERO_DECIMAL_CURRENCIES.has(normalizeTaxiCurrencyUpper(currency));
}

/** Convert internal amount_cents (DB) to Stripe smallest-unit amount. */
export function toStripeAmount(currency: unknown, amountCents: unknown): number {
  const cents = Math.round(Number(amountCents ?? 0));
  if (!Number.isFinite(cents) || cents < 0) return 0;

  if (isZeroDecimalTaxiCurrency(currency)) {
    return Math.round(cents / 100);
  }

  return cents;
}

/** Convert Stripe smallest-unit amount back to internal amount_cents (DB). */
export function fromStripeAmount(currency: unknown, stripeAmount: unknown): number {
  const units = Math.round(Number(stripeAmount ?? 0));
  if (!Number.isFinite(units) || units < 0) return 0;

  if (isZeroDecimalTaxiCurrency(currency)) {
    return units * 100;
  }

  return units;
}

/** Human-readable checkout label using DB amount_cents. */
export function formatTaxiCheckoutAmount(
  currency: unknown,
  amountCents: unknown,
  locale = "en-US"
): string {
  const code = normalizeTaxiCurrencyUpper(currency);
  const value = Number(amountCents ?? 0) / 100;
  if (!Number.isFinite(value)) return `${code} 0`;

  const intlLocale = locale.startsWith("fr") ? "fr-FR" : "en-US";
  try {
    return new Intl.NumberFormat(intlLocale, {
      style: "currency",
      currency: code,
    }).format(value);
  } catch {
    return `${value.toFixed(isZeroDecimalTaxiCurrency(code) ? 0 : 2)} ${code}`;
  }
}

export function assertStripeAmountConversion(
  currency: unknown,
  amountCents: number
): { stripeAmount: number; amountCents: number } {
  const stripeAmount = toStripeAmount(currency, amountCents);
  const roundTrip = fromStripeAmount(currency, stripeAmount);
  return { stripeAmount, amountCents: roundTrip };
}
