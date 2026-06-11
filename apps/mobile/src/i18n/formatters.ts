import { ensureAppLocale } from "./deviceLocale";

const INTL_LOCALE: Record<string, string> = {
  en: "en-US",
  fr: "fr-FR",
  es: "es-ES",
  ar: "ar",
  zh: "zh-CN",
  ff: "ff-SN",
};

export function intlLocaleTag(language?: string | null): string {
  const code = ensureAppLocale(String(language ?? "en"));
  return INTL_LOCALE[code] ?? "en-US";
}

export function formatMoney(
  amount: number,
  currency = "USD",
  language?: string | null
): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${currency} 0`;

  try {
    return new Intl.NumberFormat(intlLocaleTag(language), {
      style: "currency",
      currency: String(currency || "USD").toUpperCase(),
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function formatMoneyFromCents(
  cents: number,
  currency = "USD",
  language?: string | null
): string {
  return formatMoney(Number(cents || 0) / 100, currency, language);
}

export function formatDateTime(
  value: string | Date,
  language?: string | null,
  options?: Intl.DateTimeFormatOptions
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat(intlLocaleTag(language), {
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  }).format(date);
}

export function formatDate(
  value: string | Date,
  language?: string | null
): string {
  return formatDateTime(value, language, { dateStyle: "medium", timeStyle: undefined });
}

export function localeForDate(language?: string | null): string {
  return intlLocaleTag(language);
}
