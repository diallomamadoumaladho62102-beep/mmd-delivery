import { normalizeTaxiCountryCode } from "@/lib/taxiCountries";

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

export const TAXI_COUNTRY_LABELS: Record<
  string,
  { en: string; fr: string }
> = {
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

const UI_STRINGS = {
  en: {
    country: "Country",
    currency: "Currency",
    estimate: "Your estimate",
    subtotal: "Subtotal",
    tax: "Tax",
    platformFee: "Platform fee",
    total: "Total",
    detectedCountry: "Detected from pickup",
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
  },
} as const;

export function resolveTaxiLanguageForCountry(
  countryCode: unknown,
  override?: unknown
): TaxiLanguageCode {
  const overrideLang = String(override ?? "")
    .trim()
    .toLowerCase();
  if (overrideLang === "fr" || overrideLang === "en") return overrideLang;

  const code = normalizeTaxiCountryCode(countryCode);
  return TAXI_COUNTRY_DEFAULT_LANGUAGE[code] ?? "en";
}

export function getTaxiCountryLabel(
  countryCode: unknown,
  language?: TaxiLanguageCode
): string {
  const code = normalizeTaxiCountryCode(countryCode);
  const lang = language ?? resolveTaxiLanguageForCountry(code);
  return TAXI_COUNTRY_LABELS[code]?.[lang] ?? code;
}

export function getTaxiUiString(
  key: keyof (typeof UI_STRINGS)["en"],
  language: TaxiLanguageCode
): string {
  return UI_STRINGS[language][key] ?? UI_STRINGS.en[key];
}

export function formatTaxiDateTime(
  value: string | Date,
  countryCode: unknown,
  language?: TaxiLanguageCode
): string {
  const lang = language ?? resolveTaxiLanguageForCountry(countryCode);
  const locale = lang === "fr" ? "fr-FR" : "en-US";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatTaxiLocalizedCurrency(
  amountMinorUnits: unknown,
  currency: unknown,
  countryCode: unknown
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
