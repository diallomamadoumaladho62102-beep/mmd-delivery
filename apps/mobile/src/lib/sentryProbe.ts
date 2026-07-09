/**
 * Mobile Sentry probe — same DSN path as production app (EXPO_PUBLIC_SENTRY_DSN).
 * Can be called from a future debug screen or from Node with the DSN for project validation.
 */
import {
  captureMobileException,
  initMobileSentry,
} from "./sentry";

export const MOBILE_SENTRY_PROBE_TAG = "mmd_sentry_probe";

export function buildMobileSentryProbeMessage(): string {
  return `MMD Sentry mobile probe ${new Date().toISOString()}`;
}

export function sendMobileSentryProbe(extra?: Record<string, unknown>): {
  ok: boolean;
  initialized: boolean;
  message: string;
  error?: string;
} {
  const message = buildMobileSentryProbeMessage();
  const initialized = initMobileSentry();
  if (!initialized) {
    return {
      ok: false,
      initialized: false,
      message,
      error: "EXPO_PUBLIC_SENTRY_DSN not configured or Sentry init failed",
    };
  }

  try {
    const err = new Error(message);
    err.name = "MmdSentryProbeError";
    captureMobileException("sentry_probe", err, {
      probe: true,
      [MOBILE_SENTRY_PROBE_TAG]: true,
      ...(extra ?? {}),
    });
    return { ok: true, initialized: true, message };
  } catch (error) {
    return {
      ok: false,
      initialized: true,
      message,
      error: error instanceof Error ? error.message : "probe_failed",
    };
  }
}
