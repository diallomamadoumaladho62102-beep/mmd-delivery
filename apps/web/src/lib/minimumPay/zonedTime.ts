const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(ms: number, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map = Object.fromEntries(
    dtf.formatToParts(new Date(ms)).map((part) => [part.type, part.value])
  ) as Record<string, string>;
  const weekday = WEEKDAY_SHORT.indexOf(map.weekday as (typeof WEEKDAY_SHORT)[number]);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday,
  };
}

export function zonedLocalToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): number {
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 8; i += 1) {
    const parts = zonedParts(guess, timeZone);
    const got = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
    const diff = wanted - got;
    if (diff === 0) {
      if (
        parts.year === year &&
        parts.month === month &&
        parts.day === day &&
        parts.hour === hour &&
        parts.minute === minute &&
        parts.second === second
      ) {
        return guess;
      }
      return Number.NaN;
    }
    guess += diff;
  }
  return Number.NaN;
}

export function addCalendarDaysInZone(
  iso: string,
  days: number,
  timeZone: string
): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || !isValidTimeZone(timeZone)) return null;
  const parts = zonedParts(ms, timeZone);
  const civil = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  civil.setUTCDate(civil.getUTCDate() + days);
  const next = zonedLocalToUtcMs(
    civil.getUTCFullYear(),
    civil.getUTCMonth() + 1,
    civil.getUTCDate(),
    parts.hour,
    parts.minute,
    parts.second,
    timeZone
  );
  if (!Number.isFinite(next)) return null;
  return new Date(next).toISOString();
}

export function nextWeekdayMidnightAfter(
  instantIso: string,
  weekday: number,
  timeZone: string
): string | null {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
  if (!isValidTimeZone(timeZone)) return null;
  const ms = Date.parse(instantIso);
  if (!Number.isFinite(ms)) return null;
  const parts = zonedParts(ms, timeZone);
  const delta = (weekday - parts.weekday + 7) % 7;
  const civil = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  civil.setUTCDate(civil.getUTCDate() + delta);
  let candidate = zonedLocalToUtcMs(
    civil.getUTCFullYear(),
    civil.getUTCMonth() + 1,
    civil.getUTCDate(),
    0,
    0,
    0,
    timeZone
  );
  if (!Number.isFinite(candidate)) return null;
  if (candidate <= ms) {
    const advanced = addCalendarDaysInZone(new Date(candidate).toISOString(), 7, timeZone);
    if (!advanced) return null;
    candidate = Date.parse(advanced);
  }
  if (!Number.isFinite(candidate) || candidate <= ms) return null;
  return new Date(candidate).toISOString();
}

export function utcIsoToDatetimeLocal(iso: string, timeZone: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || !isValidTimeZone(timeZone)) return "";
  const parts = zonedParts(ms, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function hasExplicitUtcOffset(value: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}

export type AdminDateParse =
  | { ok: true; iso: string | null }
  | { ok: false; error: "invalid_timezone" | "invalid_datetime" | "timezone_required" };

/**
 * Admin datetime-local is a wall clock without offset.
 * Conversion: local civil time in the configured engine timezone → UTC ISO.
 * Explicit Z / ±HH:MM values are kept as absolute instants.
 */
export function parseAdminDateTime(
  raw: unknown,
  timeZone: string | null
): AdminDateParse {
  if (raw == null) return { ok: true, iso: null };
  const value = String(raw).trim();
  if (!value) return { ok: true, iso: null };

  if (hasExplicitUtcOffset(value)) {
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return { ok: false, error: "invalid_datetime" };
    return { ok: true, iso: new Date(ms).toISOString() };
  }

  const zone = String(timeZone ?? "").trim();
  if (!zone) return { ok: false, error: "timezone_required" };
  if (!isValidTimeZone(zone)) return { ok: false, error: "invalid_timezone" };

  const match = WALL_CLOCK.exec(value);
  if (!match) return { ok: false, error: "invalid_datetime" };
  const utc = zonedLocalToUtcMs(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? 0),
    zone
  );
  if (!Number.isFinite(utc)) return { ok: false, error: "invalid_datetime" };
  return { ok: true, iso: new Date(utc).toISOString() };
}
