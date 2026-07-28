import type { SupabaseClient } from "@supabase/supabase-js";
import type { IdentitySubjectType, IdentityVerificationStatus } from "./types";

/**
 * Best-effort identity notifications.
 * Prefer push tokens when present; never throws to webhook callers.
 */
export async function notifyIdentityStatusChange(
  supabase: SupabaseClient,
  input: {
    subjectUserId: string;
    subjectType: IdentitySubjectType;
    status: IdentityVerificationStatus | "pending";
    reason?: string | null;
  }
): Promise<void> {
  try {
    const title =
      input.status === "verified"
        ? "Identity verified"
        : input.status === "requires_input"
          ? "Identity verification needs attention"
          : input.status === "failed"
            ? "Identity verification failed"
            : input.status === "processing"
              ? "Identity verification in progress"
              : "Identity verification update";

    const body =
      input.status === "verified"
        ? "Your identity verification was successful."
        : input.status === "requires_input"
          ? "Additional information is required to complete verification."
          : input.status === "failed"
            ? String(input.reason ?? "Please try again or contact support.")
            : input.status === "pending"
              ? "Your identity verification has started."
              : `Status: ${input.status}`;

    await supabase.from("notification_logs").insert({
      user_id: input.subjectUserId,
      role: input.subjectType,
      title,
      body,
      data: {
        channel: "identity",
        subject_type: input.subjectType,
        status: input.status,
        reason: input.reason ?? null,
      },
      status: "queued",
      dedup_key: `identity:${input.subjectType}:${input.subjectUserId}:${input.status}:${Date.now()}`,
    });
  } catch (error) {
    console.warn("[identityVerification.notify] failed", error);
  }
}
