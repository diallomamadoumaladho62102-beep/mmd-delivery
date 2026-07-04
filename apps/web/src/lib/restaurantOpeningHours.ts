type DayHours = { open?: string; close?: string };
export type OpeningHoursMap = Record<string, DayHours>;

const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function parseTimeToMinutes(value: string | undefined | null): number | null {
  const clean = String(value ?? "").trim();
  if (!clean) return null;
  const match = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function currentDayKey(now: Date): string {
  return DAY_KEYS[now.getDay()];
}

function hasConfiguredHours(openingHours: OpeningHoursMap | null | undefined): boolean {
  if (!openingHours || typeof openingHours !== "object") return false;
  return Object.values(openingHours).some((day) => {
    const open = String(day?.open ?? "").trim();
    const close = String(day?.close ?? "").trim();
    return Boolean(open && close);
  });
}

export function isRestaurantWithinOpeningHours(
  openingHours: OpeningHoursMap | null | undefined,
  now = new Date(),
): boolean {
  if (!hasConfiguredHours(openingHours)) return true;

  const day = openingHours?.[currentDayKey(now)];
  const openMinutes = parseTimeToMinutes(day?.open);
  const closeMinutes = parseTimeToMinutes(day?.close);
  if (openMinutes == null || closeMinutes == null) return false;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  if (closeMinutes >= openMinutes) {
    return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
  }

  return currentMinutes >= openMinutes || currentMinutes < closeMinutes;
}
