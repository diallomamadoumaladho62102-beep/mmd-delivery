import * as Sentry from "@sentry/nextjs";
import { isSentryConfigured } from "@/lib/sentryCapture";

export const SENTRY_PROBE_TAG = "mmd_sentry_probe";

export function buildSentryProbeMessage(target: "web" | "mobile"): string {
  return `MMD Sentry ${target} probe ${new Date().toISOString()}`;
}

export function readWebSentryDsnConfigured(): {
  configured: boolean;
  sources: { NEXT_PUBLIC_SENTRY_DSN: boolean; SENTRY_DSN: boolean };
} {
  const pub = Boolean(String(process.env.NEXT_PUBLIC_SENTRY_DSN ?? "").trim());
  const server = Boolean(String(process.env.SENTRY_DSN ?? "").trim());
  return {
    configured: pub || server,
    sources: {
      NEXT_PUBLIC_SENTRY_DSN: pub,
      SENTRY_DSN: server,
    },
  };
}

/**
 * Server-side probe: captures a tagged exception and flushes to Sentry.
 * Returns eventId when Sentry accepted the event locally (flush success).
 */
export async function sendWebSentryProbe(meta?: Record<string, unknown>): Promise<{
  ok: boolean;
  configured: boolean;
  eventId: string | null;
  message: string;
  error?: string;
}> {
  const configured = isSentryConfigured();
  const message = buildSentryProbeMessage("web");

  if (!configured) {
    return {
      ok: false,
      configured: false,
      eventId: null,
      message,
      error: "sentry_dsn_not_configured",
    };
  }

  try {
    const err = new Error(message);
    err.name = "MmdSentryProbeError";
    const eventId = Sentry.captureException(err, {
      tags: {
        [SENTRY_PROBE_TAG]: "true",
        probe_target: "web",
      },
      extra: {
        probe: true,
        ...(meta ?? {}),
      },
      level: "error",
    });

    const flushed = await Sentry.flush(5000);
    return {
      ok: Boolean(eventId) && flushed,
      configured: true,
      eventId: eventId ? String(eventId) : null,
      message,
      error: flushed ? undefined : "sentry_flush_timeout",
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      eventId: null,
      message,
      error: error instanceof Error ? error.message : "sentry_probe_failed",
    };
  }
}
