import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { applyProviderSessionSnapshot } from "./service";
import type { IdentitySubjectType } from "./types";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Handles official Stripe Identity VerificationSession webhook events.
 * Must run only after signature verification on the shared webhook route.
 */
export async function handleStripeIdentityWebhookEvent(
  supabase: SupabaseClient,
  event: Stripe.Event
): Promise<{ handled: boolean; detail?: string }> {
  if (!String(event.type).startsWith("identity.verification_session.")) {
    return { handled: false };
  }

  const session = asRecord(event.data.object);
  const sessionId = typeof session.id === "string" ? session.id : null;
  if (!sessionId) {
    return { handled: true, detail: "missing_session_id" };
  }

  const lastError = asRecord(session.last_error);
  const report =
    typeof session.last_verification_report === "string"
      ? session.last_verification_report
      : asRecord(session.last_verification_report).id;

  const result = await applyProviderSessionSnapshot(supabase, {
    sessionId,
    providerStatus: String(session.status ?? "requires_input"),
    lastErrorCode: typeof lastError.code === "string" ? lastError.code : null,
    lastErrorReason:
      typeof lastError.reason === "string"
        ? lastError.reason
        : typeof lastError.message === "string"
          ? lastError.message
          : null,
    verificationReportId: typeof report === "string" ? report : null,
    providerEventId: event.id,
    eventType: event.type,
    raw: session,
  });

  return {
    handled: true,
    detail: result.ok
      ? `identity_synced:${result.status ?? "unknown"}`
      : "identity_session_not_linked",
  };
}

export function isIdentitySubjectType(value: unknown): value is IdentitySubjectType {
  return (
    value === "driver" ||
    value === "restaurant" ||
    value === "seller" ||
    value === "business" ||
    value === "client" ||
    value === "admin"
  );
}
