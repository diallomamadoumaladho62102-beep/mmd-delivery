/**
 * Mobile Sentry bootstrap. No-ops when EXPO_PUBLIC_SENTRY_DSN is unset.
 */
import Constants from "expo-constants";

type SentryModule = {
  init: (options: Record<string, unknown>) => void;
  captureException: (error: unknown, context?: Record<string, unknown>) => void;
  wrap: <T>(component: T) => T;
};

let sentryModule: SentryModule | null = null;
let initialized = false;

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
