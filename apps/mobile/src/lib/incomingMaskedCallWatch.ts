/**
 * Incoming masked-call watch policy.
 *
 * Production Sentry (iPhone, App Hanging ≥ 2s) showed stacked
 * `call_sessions` reads on the UI thread path. The host used to:
 *   - poll every 4s
 *   - subscribe to every row on `call_sessions` (no filter)
 *   - refetch on TOKEN_REFRESHED
 * Those three sources overlapped and re-rendered the incoming Modal.
 */

export const INCOMING_CALL_POLL_MS = 12_000;
export const INCOMING_CALL_MIN_FETCH_GAP_MS = 3_000;

const INCOMING_STATUSES = new Set(["active", "ringing", "queued", "initiated"]);

export type IncomingCallAuthEvent =
  | "INITIAL_SESSION"
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "TOKEN_REFRESHED"
  | "USER_UPDATED"
  | "PASSWORD_RECOVERY"
  | string;

export type IncomingCallAppState = "active" | "background" | "inactive" | string;

export type IncomingCallSessionRow = {
  id: string;
  caller_role: string | null;
  target_role: string | null;
  status: string | null;
  order_id: string | null;
  expires_at?: string | null;
  ended_at?: string | null;
};

export function isIncomingCallStatus(status: string | null | undefined): boolean {
  return INCOMING_STATUSES.has(String(status ?? "").trim().toLowerCase());
}

export function shouldFetchIncomingCallsOnAuthEvent(
  event: IncomingCallAuthEvent,
): boolean {
  return event === "SIGNED_IN" || event === "SIGNED_OUT";
}

export function shouldWatchIncomingCalls(appState: IncomingCallAppState): boolean {
  // Pause only when we know the UI is not in the foreground. `unknown` (cold
  // start) must keep watching so the first incoming ring is not delayed 12s.
  return appState !== "background" && appState !== "inactive";
}

export function callSessionsRealtimeFilter(userId: string): string {
  const uid = String(userId ?? "").trim();
  return `target_user_id=eq.${uid}`;
}

export function filterIncomingCallSessions(
  rows: IncomingCallSessionRow[],
  nowMs = Date.now(),
): IncomingCallSessionRow[] {
  return rows.filter((row) => {
    if (!isIncomingCallStatus(row.status) || row.ended_at) return false;
    if (!row.expires_at) return true;
    const expires = new Date(row.expires_at).getTime();
    return Number.isFinite(expires) && expires > nowMs;
  });
}

export function incomingCallSessionsEqual(
  a: IncomingCallSessionRow[],
  b: IncomingCallSessionRow[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((row, index) => {
    const other = b[index];
    return (
      row.id === other.id &&
      row.status === other.status &&
      row.ended_at === other.ended_at &&
      row.expires_at === other.expires_at &&
      row.order_id === other.order_id &&
      row.caller_role === other.caller_role
    );
  });
}

export function createIncomingCallFetchGate(options?: {
  minGapMs?: number;
  now?: () => number;
}) {
  const minGapMs = options?.minGapMs ?? INCOMING_CALL_MIN_FETCH_GAP_MS;
  const now = options?.now ?? Date.now;
  let inFlight = false;
  let queued: (() => Promise<void>) | null = null;
  let lastStartedAt = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flushQueued = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const next = queued;
    queued = null;
    if (next) void run(next, true);
  };

  const scheduleFlush = () => {
    if (flushTimer || inFlight) return;
    const wait = Math.max(0, minGapMs - (now() - lastStartedAt));
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushQueued();
    }, wait);
  };

  const run = async (fn: () => Promise<void>, force = false): Promise<void> => {
    if (inFlight) {
      queued = fn;
      return;
    }
    const started = now();
    if (!force && lastStartedAt > 0 && started - lastStartedAt < minGapMs) {
      queued = fn;
      scheduleFlush();
      return;
    }
    inFlight = true;
    lastStartedAt = started;
    try {
      await fn();
    } finally {
      inFlight = false;
      if (queued) flushQueued();
    }
  };

  return {
    run,
    dispose() {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      queued = null;
    },
    get inFlight() {
      return inFlight;
    },
    get pending() {
      return queued != null;
    },
  };
}
