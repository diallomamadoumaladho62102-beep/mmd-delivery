/**
 * Shared Driver earnings period windows (local device timezone).
 * Used by Earnings + Home Today's summary so ranges never drift apart.
 */

export type EarningsPeriodKey = "today" | "week" | "month";

export type EarningsPeriodRange = {
  key: EarningsPeriodKey;
  fromISO: string;
  toISO: string;
  from: Date;
  to: Date;
};

export function startOfLocalDay(d: Date = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfLocalDay(d: Date = new Date()): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function startOfLocalWeekMonday(d: Date = new Date()): Date {
  const x = startOfLocalDay(d);
  const day = x.getDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? 6 : day - 1;
  x.setDate(x.getDate() - diff);
  return x;
}

export function startOfLocalMonth(d: Date = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

export function getEarningsPeriodRange(
  key: EarningsPeriodKey,
  now: Date = new Date(),
): EarningsPeriodRange {
  const to = endOfLocalDay(now);
  let from: Date;
  if (key === "today") {
    from = startOfLocalDay(now);
  } else if (key === "month") {
    from = startOfLocalMonth(now);
  } else {
    from = startOfLocalWeekMonday(now);
  }
  return {
    key,
    from,
    to,
    fromISO: from.toISOString(),
    toISO: to.toISOString(),
  };
}

/** Alias used by Home Today's summary. */
export function getLocalDayRangeIso(d: Date = new Date()) {
  const r = getEarningsPeriodRange("today", d);
  return { fromISO: r.fromISO, toISO: r.toISO };
}

/**
 * Completion stamp for earnings membership (prefer completion over create).
 * Taxi: completed_at; Food/Delivery: delivered_at / delivered_confirmed_at.
 */
export function getEarningsCompletionStamp(row: {
  completed_at?: string | null;
  delivered_at?: string | null;
  delivered_confirmed_at?: string | null;
  dropoff_code_verified_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}): string | null {
  const stamp = String(
    row.completed_at ??
      row.delivered_at ??
      row.delivered_confirmed_at ??
      row.dropoff_code_verified_at ??
      row.updated_at ??
      row.created_at ??
      "",
  ).trim();
  return stamp || null;
}

export function isStampInEarningsRange(
  stamp: string | null | undefined,
  fromISO: string,
  toISO: string,
): boolean {
  if (!stamp) return false;
  const t = new Date(stamp).getTime();
  if (!Number.isFinite(t)) return false;
  const from = new Date(fromISO).getTime();
  const to = new Date(toISO).getTime();
  if (Number.isFinite(from) && t < from) return false;
  if (Number.isFinite(to) && t > to) return false;
  return true;
}
