/**
 * Shared Sentry noise-reduction + de-duplication used by the web client and
 * server init. Goals:
 *  - drop parasite/noise events (browser extensions, benign ResizeObserver
 *    loops, aborted/offline network fetches, expected invalid-JSON 400s);
 *  - de-duplicate identical events fired in a short window (avoid flooding).
 * These are pure/portable so they can be unit-tested and reused.
 */

// Messages matched here are dropped by the SDK's own `ignoreErrors`.
export const SENTRY_IGNORE_ERRORS: (string | RegExp)[] = [
  "ResizeObserver loop limit exceeded",
  "ResizeObserver loop completed with undelivered notifications",
  /^Non-Error promise rejection captured/i,
  "AbortError",
  "The operation was aborted",
  "The user aborted a request",
  "Failed to fetch",
  "NetworkError when attempting to fetch resource",
  "Load failed",
  "Network request failed",
];

// URLs matched here are dropped (browser extensions / non-app origins).
export const SENTRY_DENY_URLS: RegExp[] = [
  /extensions\//i,
  /^chrome:\/\//i,
  /^moz-extension:\/\//i,
  /^safari-extension:\/\//i,
  /^webkit-masked-url:/i,
];

// Extra message patterns considered pure noise (checked against the resolved
// error message / original exception, which `ignoreErrors` may not see).
const NOISE_MESSAGE_PATTERNS: RegExp[] = [
  /invalid_json/i,
  /SyntaxError.*JSON/i,
  /Unexpected end of JSON input/i,
  /JSON\.parse/i,
];

// Transient network / offline failures that are pure client-side noise (flaky
// connectivity, user navigating away, aborted requests). Patterns are anchored
// on the recognizable network signature so we don't accidentally drop genuine
// application errors that merely mention a word like "load" or "timeout".
export const SENTRY_NETWORK_NOISE_PATTERNS: RegExp[] = [
  /\b(?:TypeError:\s*)?Failed to fetch\b/i,
  /\bNetworkError when attempting to fetch resource\b/i,
  /\bNetwork request failed\b/i,
  /\bLoad failed\b/i,
  /\bThe (?:operation|request) was aborted\b/i,
  /\bThe user aborted a request\b/i,
  /\bAbortError\b/i,
  /\bnet::ERR_[A-Z_]+\b/,
  /\bERR_(?:NETWORK|INTERNET_DISCONNECTED|CONNECTION_(?:RESET|REFUSED|CLOSED|TIMED_OUT)|NAME_NOT_RESOLVED)\b/i,
  /\b(?:connection|socket)\s+(?:was\s+)?(?:reset|refused|closed|timed out)\b/i,
  /\b(?:request|network)\s+timed out\b/i,
];

export function isNetworkNoiseMessage(message: string): boolean {
  return SENTRY_NETWORK_NOISE_PATTERNS.some((re) => re.test(message));
}

function messageFromEvent(event: SentryLikeEvent, hint?: SentryLikeHint): string {
  const original = hint?.originalException;
  if (original instanceof Error) return `${original.name}: ${original.message}`;
  if (typeof original === "string") return original;
  const values = event?.exception?.values;
  if (Array.isArray(values) && values.length > 0) {
    return values.map((v) => `${v?.type ?? ""}: ${v?.value ?? ""}`).join(" | ");
  }
  return String(event?.message ?? "");
}

/** Stable-ish signature used for short-window de-duplication. */
export function eventSignature(event: SentryLikeEvent, hint?: SentryLikeHint): string {
  const msg = messageFromEvent(event, hint);
  const frame = event?.exception?.values?.[0]?.stacktrace?.frames?.slice(-1)?.[0];
  const loc = frame ? `${frame.filename ?? ""}:${frame.lineno ?? ""}` : "";
  return `${event?.level ?? "error"}|${msg}|${loc}`;
}

export function isNoiseMessage(message: string): boolean {
  return (
    NOISE_MESSAGE_PATTERNS.some((re) => re.test(message)) ||
    isNetworkNoiseMessage(message)
  );
}

// Minimal shapes (avoid depending on the SDK types in a portable module).
type SentryLikeFrame = { filename?: string; lineno?: number };
type SentryLikeException = {
  type?: string;
  value?: string;
  stacktrace?: { frames?: SentryLikeFrame[] };
};
export type SentryLikeEvent = {
  level?: string;
  message?: string;
  exception?: { values?: SentryLikeException[] };
};
export type SentryLikeHint = { originalException?: unknown };

/**
 * Build a `beforeSend` closure with its own in-memory de-dup cache. Returns
 * `null` to drop an event, or the event to keep it.
 */
export function createSentryBeforeSend(options?: { dedupeWindowMs?: number }) {
  const windowMs = options?.dedupeWindowMs ?? 15_000;
  const recent = new Map<string, number>();

  return function beforeSend(
    event: SentryLikeEvent,
    hint?: SentryLikeHint,
  ): SentryLikeEvent | null {
    const message = messageFromEvent(event, hint);
    if (isNoiseMessage(message)) return null;

    const now = Date.now();
    const sig = eventSignature(event, hint);
    const last = recent.get(sig);
    if (last !== undefined && now - last < windowMs) return null;
    recent.set(sig, now);

    // Bound cache size.
    if (recent.size > 200) {
      for (const [key, ts] of recent) {
        if (now - ts >= windowMs) recent.delete(key);
      }
    }
    return event;
  };
}
