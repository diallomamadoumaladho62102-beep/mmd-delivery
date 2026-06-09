export type TaxiLanguageCode = "en" | "fr";

export const TAXI_COUNTRY_DEFAULT_LANGUAGE: Record<string, TaxiLanguageCode> = {
  US: "en",
  CA: "en",
  GB: "en",
  SL: "en",
  FR: "fr",
  BE: "fr",
  GN: "fr",
  SN: "fr",
  CI: "fr",
  ML: "fr",
  MR: "fr",
};

export const TAXI_COUNTRY_LABELS: Record<string, { en: string; fr: string }> = {
  US: { en: "United States", fr: "États-Unis" },
  CA: { en: "Canada", fr: "Canada" },
  GB: { en: "United Kingdom", fr: "Royaume-Uni" },
  FR: { en: "France", fr: "France" },
  BE: { en: "Belgium", fr: "Belgique" },
  GN: { en: "Guinea", fr: "Guinée" },
  SN: { en: "Senegal", fr: "Sénégal" },
  CI: { en: "Côte d'Ivoire", fr: "Côte d'Ivoire" },
  ML: { en: "Mali", fr: "Mali" },
  SL: { en: "Sierra Leone", fr: "Sierra Leone" },
  MR: { en: "Mauritania", fr: "Mauritanie" },
};

const UI = {
  en: {
    country: "Country",
    currency: "Currency",
    estimate: "Your estimate",
    subtotal: "Subtotal",
    tax: "Tax",
    platformFee: "Platform fee",
    total: "Total",
    detectedCountry: "Detected from pickup",
    estimatesIn: "Estimates in",
  },
  fr: {
    country: "Pays",
    currency: "Devise",
    estimate: "Votre estimation",
    subtotal: "Sous-total",
    tax: "Taxes",
    platformFee: "Frais plateforme",
    total: "Total",
    detectedCountry: "Détecté depuis le pickup",
    estimatesIn: "Estimation en",
  },
} as const;

export function resolveTaxiLanguageForCountry(countryCode: string): TaxiLanguageCode {
  return TAXI_COUNTRY_DEFAULT_LANGUAGE[String(countryCode ?? "US").toUpperCase()] ?? "en";
}

export function getTaxiCountryLabel(
  countryCode: string,
  language?: TaxiLanguageCode
): string {
  const code = String(countryCode ?? "US").toUpperCase();
  const lang = language ?? resolveTaxiLanguageForCountry(code);
  return TAXI_COUNTRY_LABELS[code]?.[lang] ?? code;
}

export function getTaxiUiString(
  key: keyof (typeof UI)["en"],
  countryCode: string
): string {
  const lang = resolveTaxiLanguageForCountry(countryCode);
  return UI[lang][key] ?? UI.en[key];
}

export function formatTaxiLocalizedCurrency(
  amountMinorUnits: unknown,
  currency: unknown,
  countryCode: string
): string {
  const lang = resolveTaxiLanguageForCountry(countryCode);
  const code = String(currency ?? "USD")
    .trim()
    .toUpperCase();
  const value = Number(amountMinorUnits ?? 0) / 100;
  if (!Number.isFinite(value)) return `${code} 0`;

  try {
    return new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US", {
      style: "currency",
      currency: code,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${code}`;
  }
}

export function formatTaxiLocalizedDateTime(
  value: string | Date,
  countryCode: string
): string {
  const lang = resolveTaxiLanguageForCountry(countryCode);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
