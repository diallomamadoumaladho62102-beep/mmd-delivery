/**
 * Mobile Sentry bootstrap. No-ops when EXPO_PUBLIC_SENTRY_DSN is unset.
 */
import Constants from "expo-constants";

type SentryModule = {
  init: (options: Record<string, unknown>) => void;
  captureException: (error: unknown, context?: Record<string, unknown>) => void;
  wrap: <T>(component: T) => T;
  setTag?: (key: string, value: string) => void;
  setContext?: (key: string, context: Record<string, unknown> | null) => void;
  addBreadcrumb?: (breadcrumb: Record<string, unknown>) => void;
};

let sentryModule: SentryModule | null = null;
let initialized = false;

// Parasite/noise messages we never want to report (offline, aborted fetches,
// benign rejections). Keeps the Sentry weekly report signal-heavy.
const IGNORE_ERRORS = [
  /^Non-Error promise rejection captured/i,
  /Unexpected end of JSON input/i,
];

// Transient network / offline failures that are pure client-side noise. Kept in
// sync with the web filter (apps/web/src/lib/sentryFilter.ts). Patterns are
// anchored on the network signature so genuine app errors are not swallowed.
const NETWORK_NOISE_PATTERNS: RegExp[] = [
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

const recentSignatures = new Map<string, number>();
const DEDUPE_WINDOW_MS = 15_000;

function shouldDrop(message: string): boolean {
  if (!message) return false;
  if (IGNORE_ERRORS.some((p) => (typeof p === "string" ? message.includes(p) : p.test(message)))) {
    return true;
  }
  if (NETWORK_NOISE_PATTERNS.some((re) => re.test(message))) {
    return true;
  }
  const now = Date.now();
  const last = recentSignatures.get(message);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return true;
  recentSignatures.set(message, now);
  if (recentSignatures.size > 200) {
    for (const [k, ts] of recentSignatures) {
      if (now - ts >= DEDUPE_WINDOW_MS) recentSignatures.delete(k);
    }
  }
  return false;
}

function readDsn(): string {
  const fromEnv = String(process.env.EXPO_PUBLIC_SENTRY_DSN ?? "").trim();
  if (fromEnv) return fromEnv;
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  return String(extra.EXPO_PUBLIC_SENTRY_DSN ?? "").trim();
}

export function initMobileSentry(): boolean {
  if (initialized) return Boolean(sentryModule);
  initialized = true;
  const dsn = readDsn();
  if (!dsn) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sentryModule = require("@sentry/react-native") as SentryModule;
    sentryModule.init({
      dsn,
      enableInExpoDevelopment: false,
      debug: false,
      environment:
        String(
          (Constants.expoConfig?.extra as Record<string, unknown> | undefined)?.APP_ENV ??
            process.env.APP_ENV ??
            "production"
        ) || "production",
      tracesSampleRate: 0.1,
      // Drop parasite/offline noise and de-duplicate bursts before sending.
      beforeSend: (event: Record<string, any>, hint: Record<string, any>) => {
        try {
          const original = hint?.originalException;
          const message =
            original instanceof Error
              ? `${original.name}: ${original.message}`
              : String(
                  event?.exception?.values?.[0]?.value ?? event?.message ?? original ?? "",
                );
          if (shouldDrop(message)) return null;
        } catch {
          // never throw from telemetry filter
        }
        return event;
      },
    });
    return true;
  } catch (error) {
    console.warn("[sentry] @sentry/react-native not available", error);
    sentryModule = null;
    return false;
  }
}

export function captureMobileException(
  scope: string,
  error: unknown,
  extra?: Record<string, unknown>
): void {
  if (!sentryModule) return;
  try {
    sentryModule.captureException(error, { extra: { scope, ...(extra ?? {}) } });
  } catch {
    // never throw from telemetry
  }
}

export function wrapWithSentry<T>(component: T): T {
  if (!sentryModule?.wrap) return component;
  try {
    return sentryModule.wrap(component);
  } catch {
    return component;
  }
}

/** Attach a persistent tag (e.g. role, screen) for richer Sentry grouping. */
export function setMobileSentryTag(key: string, value: string | null | undefined): void {
  if (!sentryModule?.setTag || !value) return;
  try {
    sentryModule.setTag(key, String(value));
  } catch {
    // never throw from telemetry
  }
}

/** Attach structured context (e.g. current trip / order snapshot). */
export function setMobileSentryContext(
  name: string,
  context: Record<string, unknown> | null,
): void {
  if (!sentryModule?.setContext) return;
  try {
    sentryModule.setContext(name, context);
  } catch {
    // never throw from telemetry
  }
}

/** Add a breadcrumb to help trace what happened before an error. */
export function addMobileBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (!sentryModule?.addBreadcrumb) return;
  try {
    sentryModule.addBreadcrumb({ category, message, level: "info", data });
  } catch {
    // never throw from telemetry
  }
}
