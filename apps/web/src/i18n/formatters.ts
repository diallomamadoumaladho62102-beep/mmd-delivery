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

function pad2(value: number): string {
  return String(Math.max(0, Math.trunc(value))).padStart(2, "0");
}

/**
 * Client-facing trip duration. Always human (never raw "3180s").
 * 3180 → "53 min 00 sec"; 3600 → "1 h 00 min 00 sec"; 7380 → "2 h 03 min 00 sec".
 */
export function formatTripDurationFromSeconds(
  totalSeconds: number | null | undefined
): string {
  if (totalSeconds == null) return "—";
  const raw = Number(totalSeconds);
  if (!Number.isFinite(raw) || raw < 0) return "—";
  const sec = Math.round(raw);
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  if (hours > 0) {
    return `${hours} h ${pad2(minutes)} min ${pad2(seconds)} sec`;
  }
  return `${minutes} min ${pad2(seconds)} sec`;
}

export function resolveRouteDurationSeconds(route: {
  durationSeconds?: unknown;
  duration_seconds?: unknown;
  durationMinutes?: unknown;
  duration_minutes?: unknown;
} | null | undefined): number | null {
  if (!route) return null;
  const seconds = Number(route.durationSeconds ?? route.duration_seconds);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  const minutes = Number(route.durationMinutes ?? route.duration_minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes >= 24 * 60) return minutes;
  return minutes * 60;
}

export function formatDurationMinutes(
  minutes: number | null | undefined,
  _locale?: WebLocale | string | null
): string {
  const seconds = resolveRouteDurationSeconds({ durationMinutes: minutes });
  if (seconds == null) return "—";
  return formatTripDurationFromSeconds(seconds);
}
