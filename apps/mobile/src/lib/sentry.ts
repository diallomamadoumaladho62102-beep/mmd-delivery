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
  /^MmdSentryProbeError:/i,
  /^MMD Sentry (?:web|mobile) probe\b/i,
  /audio session not activated/i,
  /Play encountered an error:\s*audio session/i,
  // Old native binaries / OTA ahead of native — guarded in useNetworkStatus; still noise if thrown
  // from leftover store builds. New store builds must ship ExpoNetwork natively.
  /Cannot find native module ['"]ExpoNetwork['"]/i,
  // SDK auto-capture of plain objects (our capture path normalizes via toCapturableError).
  /Object captured as exception with keys/i,
  // Expected taxi/checkout unpaid confirm (HTTP 409) — business outcome, not an app defect.
  /Stripe payment not confirmed yet/i,
  /payment was not completed\.?\s*please check your payment method/i,
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
  // Gateway / edge timeouts — infra noise, not app defects.
  /\bHTTP\s+50[234]\b/i,
  /\bGateway Time-?out\b/i,
];

const recentSignatures = new Map<string, number>();
const DEDUPE_WINDOW_MS = 15_000;

function shouldDrop(message: string): boolean {
  const trimmed = String(message ?? "").trim();
  if (!trimmed || trimmed === "<unknown>" || trimmed === "Error" || trimmed === "Error:") {
    return true;
  }
  if (IGNORE_ERRORS.some((p) => (typeof p === "string" ? trimmed.includes(p) : p.test(trimmed)))) {
    return true;
  }
  if (NETWORK_NOISE_PATTERNS.some((re) => re.test(trimmed))) {
    return true;
  }
  const now = Date.now();
  const last = recentSignatures.get(trimmed);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return true;
  recentSignatures.set(trimmed, now);
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
    // Dynamic require keeps Metro optional when the native module is absent in some builds.
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
          const tags = event?.tags ?? {};
          if (tags?.mmd_sentry_probe === "true" || tags?.mmd_sentry_probe === true) {
            return null;
          }
          const original = hint?.originalException;
          const exceptionValue = String(event?.exception?.values?.[0]?.value ?? "").trim();
          const message =
            original instanceof Error
              ? `${original.name}: ${original.message}`
              : String(exceptionValue || event?.message || original || "");
          if (shouldDrop(message) || shouldDrop(exceptionValue)) return null;
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
    try {
      const { isExpectedUnpaidPaymentSentryNoise } =
        require("./taxiPaymentAbandonFlow") as {
          isExpectedUnpaidPaymentSentryNoise: (
            error: unknown,
            metadata?: Record<string, unknown> | null,
          ) => boolean;
        };
      if (isExpectedUnpaidPaymentSentryNoise(error, extra ?? null)) {
        return;
      }
    } catch {
      // continue — never block capture of real errors if helper fails
    }

    const { toCapturableError } = require("./toCapturableError") as {
      toCapturableError: (error: unknown, fallbackMessage?: string) => Error;
    };
    const capturable = toCapturableError(error, scope);
    if (shouldDrop(`${capturable.name}: ${capturable.message}`)) {
      return;
    }
    sentryModule.captureException(capturable, {
      extra: { scope, ...(extra ?? {}), original: error },
    });
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
