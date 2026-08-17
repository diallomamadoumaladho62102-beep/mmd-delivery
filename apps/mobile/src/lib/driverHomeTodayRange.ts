/**
 * Local calendar-day window matching Driver Earnings "Today" range.
 */

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

export function getLocalDayRangeIso(d: Date = new Date()): {
  fromISO: string;
  toISO: string;
} {
  return {
    fromISO: startOfLocalDay(d).toISOString(),
    toISO: endOfLocalDay(d).toISOString(),
  };
}
