export const PLATFORM_CURRENCY_BY_COUNTRY: Record<string, string> = {
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

export const PLATFORM_CHECKOUT_CURRENCIES = new Set([
  "USD",
  "CAD",
  "GBP",
  "EUR",
  "GNF",
  "XOF",
  "SLE",
  "MRU",
]);

export function normalizePlatformCountryCode(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .slice(0, 2);
}

export function roundPlatformMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function currencyForPlatformCountry(
  countryCode: unknown,
  options?: { strict?: boolean }
): string {
  const code = normalizePlatformCountryCode(countryCode);
  if (!code) {
    if (options?.strict) {
      throw new Error("country_code_required");
    }
    return "USD";
  }

  const currency = PLATFORM_CURRENCY_BY_COUNTRY[code];
  if (!currency) {
    if (options?.strict) {
      throw new Error(`unsupported_country_currency:${code}`);
    }
    return "USD";
  }

  return currency;
}
