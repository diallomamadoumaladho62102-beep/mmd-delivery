import type { WebLocale } from "./locales";

/** Intl locale tags — aligned with mobile `apps/mobile/src/i18n/formatters.ts`. */
const INTL_LOCALE: Record<WebLocale, string> = {
  en: "en-US",
  fr: "fr-FR",
  es: "es-ES",
  ar: "ar",
  zh: "zh-CN",
  ff: "ff-SN",
};

export function intlLocaleTag(locale: WebLocale | string | null | undefined): string {
  const code = String(locale ?? "en").toLowerCase().slice(0, 2);
  if (code === "fr") return INTL_LOCALE.fr;
  if (code === "es") return INTL_LOCALE.es;
  if (code === "ar") return INTL_LOCALE.ar;
  if (code === "zh") return INTL_LOCALE.zh;
  if (code === "ff") return INTL_LOCALE.ff;
  return INTL_LOCALE.en;
}

export function formatMoney(
  amount: number,
  currency = "USD",
  locale?: WebLocale | string | null
): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${currency} 0`;
  try {
    return new Intl.NumberFormat(intlLocaleTag(locale), {
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
  locale?: WebLocale | string | null
): string {
  return formatMoney(Number(cents || 0) / 100, currency, locale);
}

export function formatDateTime(
  value: string | Date,
  locale?: WebLocale | string | null,
  options?: Intl.DateTimeFormatOptions
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(intlLocaleTag(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  }).format(date);
}

export function formatDate(
  value: string | Date,
  locale?: WebLocale | string | null
): string {
  return formatDateTime(value, locale, { dateStyle: "medium", timeStyle: undefined });
}

export function usesMetricUnits(locale?: WebLocale | string | null): boolean {
  const tag = intlLocaleTag(locale);
  return !tag.toLowerCase().startsWith("en-us");
}

export function formatDistance(
  distanceMiles: number | null | undefined,
  locale?: WebLocale | string | null,
  options?: { maximumFractionDigits?: number }
): string {
  const miles = Number(distanceMiles);
  if (!Number.isFinite(miles) || miles < 0) return "—";
  const digits = options?.maximumFractionDigits ?? 1;
  const tag = intlLocaleTag(locale);
  if (usesMetricUnits(locale)) {
    const km = miles * 1.60934;
    return new Intl.NumberFormat(tag, {
      style: "unit",
      unit: "kilometer",
      unitDisplay: "short",
      maximumFractionDigits: digits,
    }).format(km);
  }
  return new Intl.NumberFormat(tag, {
    style: "unit",
    unit: "mile",
    unitDisplay: "short",
    maximumFractionDigits: digits,
  }).format(miles);
}

export function formatDurationMinutes(
  minutes: number | null | undefined,
  locale?: WebLocale | string | null
): string {
  const mins = Math.round(Number(minutes));
  if (!Number.isFinite(mins) || mins < 0) return "—";
  const tag = intlLocaleTag(locale);
  if (mins < 60) {
    return new Intl.NumberFormat(tag, {
      style: "unit",
      unit: "minute",
      unitDisplay: "short",
      maximumFractionDigits: 0,
    }).format(mins);
  }
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  const hourPart = new Intl.NumberFormat(tag, {
    style: "unit",
    unit: "hour",
    unitDisplay: "short",
    maximumFractionDigits: 0,
  }).format(hours);
  if (rem <= 0) return hourPart;
  const minPart = new Intl.NumberFormat(tag, {
    style: "unit",
    unit: "minute",
    unitDisplay: "short",
    maximumFractionDigits: 0,
  }).format(rem);
  return `${hourPart} ${minPart}`;
}
