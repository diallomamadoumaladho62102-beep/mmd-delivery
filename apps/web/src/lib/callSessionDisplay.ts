export const CALL_SESSION_TERMINAL_STATUSES = [
  "completed",
  "ended",
  "failed",
  "busy",
  "no-answer",
  "no_answer",
  "canceled",
  "cancelled",
  "missed",
  "declined",
  "expired",
] as const;

export const CALL_SESSION_LIVE_STATUSES = [
  "active",
  "in_progress",
  "ringing",
  "queued",
  "initiated",
  "created",
  "pending",
  "connected",
] as const;

export type CallSessionTimingRow = {
  status?: string | null;
  started_at?: string | null;
  answered_at?: string | null;
  ended_at?: string | null;
  expires_at?: string | null;
  created_at?: string | null;
  duration_seconds?: number | null;
};

export function normalizeCallStatus(status: string | null | undefined): string {
  return String(status ?? "unknown").trim().toLowerCase() || "unknown";
}

export function isTerminalCallStatus(status: string | null | undefined): boolean {
  return (CALL_SESSION_TERMINAL_STATUSES as readonly string[]).includes(
    normalizeCallStatus(status),
  );
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function isCallSessionExpiredByTtl(
  row: Pick<CallSessionTimingRow, "expires_at" | "ended_at" | "status">,
  nowMs = Date.now(),
): boolean {
  if (row.ended_at || isTerminalCallStatus(row.status)) return false;
  const expires = parseTime(row.expires_at);
  return expires != null && expires < nowMs;
}

export function resolveCallSessionDisplayStatus(
  row: CallSessionTimingRow,
  nowMs = Date.now(),
): string {
  if (isCallSessionExpiredByTtl(row, nowMs)) return "expired";
  if (row.ended_at && !isTerminalCallStatus(row.status)) return "completed";
  return normalizeCallStatus(row.status);
}

export function isCallSessionLive(
  row: CallSessionTimingRow,
  nowMs = Date.now(),
): boolean {
  const display = resolveCallSessionDisplayStatus(row, nowMs);
  return (CALL_SESSION_LIVE_STATUSES as readonly string[]).includes(display);
}

/**
 * Talk / ring duration for history.
 * Never uses "now" for a finished, expired, or ended-missing row.
 */
export function callSessionDurationSeconds(
  row: CallSessionTimingRow,
  nowMs = Date.now(),
): number | null {
  const stored = Number(row.duration_seconds);
  if (Number.isFinite(stored) && stored >= 0) {
    return Math.floor(stored);
  }

  const start = parseTime(row.answered_at) ?? parseTime(row.started_at);
  const ended = parseTime(row.ended_at);
  const display = resolveCallSessionDisplayStatus(row, nowMs);

  if (ended != null && start != null && ended >= start) {
    return Math.floor((ended - start) / 1000);
  }

  if (ended != null && start == null) return null;

  if (isCallSessionLive(row, nowMs) && start != null && nowMs >= start) {
    return Math.floor((nowMs - start) / 1000);
  }

  if (display === "expired" || isTerminalCallStatus(display) || !start) {
    return null;
  }

  return null;
}

export function formatCallDurationClock(totalSeconds: number | null): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "—";
  }
  const sec = Math.floor(totalSeconds);
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatCallSessionDuration(
  row: CallSessionTimingRow,
  nowMs = Date.now(),
): string {
  return formatCallDurationClock(callSessionDurationSeconds(row, nowMs));
}

export function callSessionPersistPatch(
  row: CallSessionTimingRow,
  nowMs = Date.now(),
): { status: string; ended_at: string } | null {
  if (isCallSessionExpiredByTtl(row, nowMs)) {
    return {
      status: "expired",
      ended_at: row.expires_at ?? new Date(nowMs).toISOString(),
    };
  }
  return null;
}
