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

/** Prefer app language; fall back to device region for unit system. */
export function usesMetricUnits(language?: string | null): boolean {
  const tag = intlLocaleTag(language);
  // US customary for en-US; metric otherwise (including fr, es, ar, zh, ff).
  return !tag.toLowerCase().startsWith("en-us");
}

export function formatDistance(
  distanceMiles: number | null | undefined,
  language?: string | null,
  options?: { maximumFractionDigits?: number }
): string {
  const miles = Number(distanceMiles);
  if (!Number.isFinite(miles) || miles < 0) return "—";
  const digits = options?.maximumFractionDigits ?? 1;
  const locale = intlLocaleTag(language);
  if (usesMetricUnits(language)) {
    const km = miles * 1.60934;
    return new Intl.NumberFormat(locale, {
      style: "unit",
      unit: "kilometer",
      unitDisplay: "short",
      maximumFractionDigits: digits,
    }).format(km);
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "mile",
    unitDisplay: "short",
    maximumFractionDigits: digits,
  }).format(miles);
}

export function formatDurationMinutes(
  minutes: number | null | undefined,
  language?: string | null
): string {
  const mins = Math.round(Number(minutes));
  if (!Number.isFinite(mins) || mins < 0) return "—";
  const locale = intlLocaleTag(language);
  if (mins < 60) {
    return new Intl.NumberFormat(locale, {
      style: "unit",
      unit: "minute",
      unitDisplay: "short",
      maximumFractionDigits: 0,
    }).format(mins);
  }
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  const hourPart = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "hour",
    unitDisplay: "short",
    maximumFractionDigits: 0,
  }).format(hours);
  if (rem <= 0) return hourPart;
  const minPart = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "minute",
    unitDisplay: "short",
    maximumFractionDigits: 0,
  }).format(rem);
  return `${hourPart} ${minPart}`;
}
