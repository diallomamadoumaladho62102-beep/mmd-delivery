import i18n from "../i18n";
import { formatMoneyFromCents, formatDateTime, intlLocaleTag } from "../i18n/formatters";

export type TaxiLanguageCode = "en" | "fr" | "es" | "ar" | "zh" | "ff";

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

export const TAXI_COUNTRY_LABELS: Record<string, Record<TaxiLanguageCode, string>> = {
  US: { en: "United States", fr: "États-Unis", es: "Estados Unidos", ar: "الولايات المتحدة", zh: "美国", ff: "Amerik" },
  CA: { en: "Canada", fr: "Canada", es: "Canadá", ar: "كندا", zh: "加拿大", ff: "Kanada" },
  GB: { en: "United Kingdom", fr: "Royaume-Uni", es: "Reino Unido", ar: "المملكة المتحدة", zh: "英国", ff: "Britanii" },
  FR: { en: "France", fr: "France", es: "Francia", ar: "فرنسا", zh: "法国", ff: "Faransi" },
  BE: { en: "Belgium", fr: "Belgique", es: "Bélgica", ar: "بلجيكا", zh: "比利时", ff: "Beljik" },
  GN: { en: "Guinea", fr: "Guinée", es: "Guinea", ar: "غينيا", zh: "几内亚", ff: "Gine" },
  SN: { en: "Senegal", fr: "Sénégal", es: "Senegal", ar: "السنغال", zh: "塞内加尔", ff: "Senegaal" },
  CI: { en: "Côte d'Ivoire", fr: "Côte d'Ivoire", es: "Costa de Marfil", ar: "ساحل العاج", zh: "科特迪瓦", ff: "Kodiwaaar" },
  ML: { en: "Mali", fr: "Mali", es: "Malí", ar: "مالي", zh: "马里", ff: "Maali" },
  SL: { en: "Sierra Leone", fr: "Sierra Leone", es: "Sierra Leona", ar: "سيراليون", zh: "塞拉利昂", ff: "Sera Leon" },
  MR: { en: "Mauritania", fr: "Mauritanie", es: "Mauritania", ar: "موريتانيا", zh: "毛里塔尼亚", ff: "Muritani" },
};

const UI_KEYS = [
  "country",
  "currency",
  "estimate",
  "subtotal",
  "tax",
  "platformFee",
  "total",
  "detectedCountry",
  "estimatesIn",
] as const;

export type TaxiUiKey = (typeof UI_KEYS)[number];

function activeAppLanguage(): TaxiLanguageCode {
  const raw = String(i18n.resolvedLanguage || i18n.language || "en").split("-")[0];
  if (raw === "fr" || raw === "es" || raw === "ar" || raw === "zh" || raw === "ff") return raw;
  return "en";
}

export function resolveTaxiLanguageForCountry(countryCode: string): TaxiLanguageCode {
  void countryCode;
  return activeAppLanguage();
}

export function getTaxiCountryLabel(
  countryCode: string,
  language?: TaxiLanguageCode
): string {
  const code = String(countryCode ?? "US").toUpperCase();
  const lang = language ?? activeAppLanguage();
  return TAXI_COUNTRY_LABELS[code]?.[lang] ?? code;
}

/** Uses global i18next locale (6 languages). Country code kept for API compat. */
export function getTaxiUiString(key: TaxiUiKey, countryCode?: string): string {
  void countryCode;
  return i18n.t(`taxi.ui.${key}`, { defaultValue: key });
}

export function formatTaxiLocalizedCurrency(
  amountMinorUnits: unknown,
  currency: unknown,
  countryCode?: string
): string {
  void countryCode;
  return formatMoneyFromCents(Number(amountMinorUnits ?? 0), String(currency ?? "USD"), i18n.language);
}

export function formatTaxiLocalizedDateTime(
  value: string | Date,
  countryCode?: string
): string {
  void countryCode;
  return formatDateTime(value, i18n.language);
}

export function taxiIntlLocale(): string {
  return intlLocaleTag();
}
