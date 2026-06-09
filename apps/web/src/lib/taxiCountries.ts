/** Taxi-supported ISO 4217 currency codes (lowercase for Stripe). */
export const TAXI_SUPPORTED_CURRENCY_CODES = [
  "usd",
  "cad",
  "gbp",
  "eur",
  "gnf",
  "xof",
  "sle",
  "mru",
] as const;

export type TaxiSupportedCurrencyCode = (typeof TAXI_SUPPORTED_CURRENCY_CODES)[number];

export const TAXI_SUPPORTED_CURRENCY_SET = new Set<string>(TAXI_SUPPORTED_CURRENCY_CODES);

export const DEFAULT_TAXI_COUNTRY_CODE = "US";

/** Static fallback when DB reference is unavailable (matches seed migration). */
export const TAXI_COUNTRY_CURRENCY_MAP: Record<string, string> = {
  US: "USD",
  CA: "CAD",
  GB: "GBP",
  FR: "EUR",
  BE: "EUR",
  GN: "GNF",
  SN: "XOF",
  CI: "XOF",
  ML: "XOF",
  SL: "SLE",
  MR: "MRU",
};

export function normalizeTaxiCountryCode(value: unknown): string {
  return String(value ?? DEFAULT_TAXI_COUNTRY_CODE)
    .trim()
    .toUpperCase()
    .slice(0, 2);
}

export function normalizeTaxiCurrencyCode(value: unknown, fallback = "USD"): string {
  const normalized = String(value ?? fallback).trim().toUpperCase();
  return normalized.length === 3 ? normalized : fallback;
}

export function normalizeTaxiCurrencyForStripe(value: unknown, fallback = "usd"): string {
  const upper = normalizeTaxiCurrencyCode(value, fallback.toUpperCase());
  const lower = upper.toLowerCase();
  return TAXI_SUPPORTED_CURRENCY_SET.has(lower) ? lower : fallback;
}

export function resolveStaticTaxiCurrencyForCountry(countryCode: string): string | null {
  return TAXI_COUNTRY_CURRENCY_MAP[normalizeTaxiCountryCode(countryCode)] ?? null;
}
