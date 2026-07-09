/**
 * Optional Sentry capture for web (Next.js).
 * No-ops when NEXT_PUBLIC_SENTRY_DSN is unset so local/dev stays quiet.
 */
import * as Sentry from "@sentry/nextjs";

function isEnabled(): boolean {
  return Boolean(
    String(process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN ?? "").trim()
  );
}

export function captureProductionException(
  scope: string,
  error: unknown,
  metadata?: Record<string, unknown>
) {
  if (!isEnabled()) return;
  try {
    Sentry.captureException(error, {
      extra: { scope, ...(metadata ?? {}) },
    });
  } catch {
    // never throw from telemetry
  }
}

export function captureProductionMessage(
  scope: string,
  message: string,
  metadata?: Record<string, unknown>
) {
  if (!isEnabled()) return;
  try {
    Sentry.captureMessage(`[${scope}] ${message}`, "error");
    if (metadata) {
      Sentry.captureException(new Error(message), { extra: { scope, ...metadata } });
    }
  } catch {
    // never throw from telemetry
  }
}

export function isSentryConfigured(): boolean {
  return isEnabled();
}
