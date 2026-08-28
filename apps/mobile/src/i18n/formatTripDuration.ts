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

/** Prefer routing seconds; fall back to minutes. Never treat implausible "minutes" as minutes. */
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
  // Mapbox duration is seconds. A "minutes" field ≥ 24h is almost certainly raw seconds.
  if (minutes >= 24 * 60) return minutes;
  return minutes * 60;
}

export function formatDurationMinutes(
  minutes: number | null | undefined,
  _language?: string | null
): string {
  const seconds = resolveRouteDurationSeconds({ durationMinutes: minutes });
  if (seconds == null) return "—";
  return formatTripDurationFromSeconds(seconds);
}
