import type { SupabaseClient } from "@supabase/supabase-js";
import type { IdentitySubjectType, IdentityVerificationStatus } from "./types";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

function isExpoPushToken(value: unknown): value is string {
  const s = String(value ?? "").trim();
  return s.startsWith("ExponentPushToken[") || s.startsWith("ExpoPushToken[");
}

async function wasAlreadyLogged(
  supabase: SupabaseClient,
  dedupKey: string
): Promise<boolean> {
  const { data } = await supabase
    .from("notification_logs")
    .select("id")
    .eq("dedup_key", dedupKey)
    .limit(1);
  return (data ?? []).length > 0;
}

async function loadTokens(
  supabase: SupabaseClient,
  userId: string
): Promise<string[]> {
  const { data } = await supabase
    .from("user_push_tokens")
    .select("expo_push_token")
    .eq("user_id", userId);

  const tokens = new Set<string>();
  for (const row of data ?? []) {
    const token = String(row.expo_push_token ?? "").trim();
    if (isExpoPushToken(token)) tokens.add(token);
  }
  return [...tokens];
}

async function sendExpo(messages: Array<Record<string, unknown>>) {
  if (messages.length === 0) return { ok: true as const };
  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "push_failed");
      return { ok: false as const, error: text };
    }
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "push_error",
    };
  }
}

function copyFor(
  status: IdentityVerificationStatus | "pending",
  reason?: string | null
): { title: string; body: string } {
  if (status === "verified") {
    return {
      title: "Identity verified",
      body: "Your identity verification was successful.",
    };
  }
  if (status === "requires_input") {
    return {
      title: "Identity verification needs attention",
      body: "Additional information is required to complete verification.",
    };
  }
  if (status === "failed" || status === "canceled") {
    return {
      title: "Identity verification failed",
      body: String(reason ?? "Please try again or contact support."),
    };
  }
  if (status === "processing") {
    return {
      title: "Identity verification in progress",
      body: "Stripe is reviewing your identity documents.",
    };
  }
  if (status === "pending") {
    return {
      title: "Identity verification started",
      body: "Complete the Stripe Identity flow to continue.",
    };
  }
  return {
    title: "Identity verification update",
    body: `Status: ${status}`,
  };
}

/**
 * Idempotent identity notifications (stable dedup_key; no Date.now()).
 * Sends Expo push when tokens exist. Never throws to webhook callers.
 */
export async function notifyIdentityStatusChange(
  supabase: SupabaseClient,
  input: {
    subjectUserId: string;
    subjectType: IdentitySubjectType;
    status: IdentityVerificationStatus | "pending";
    reason?: string | null;
    /** Prefer provider event id or session id for stable dedupe. */
    dedupeSuffix?: string | null;
    notifyAdmins?: boolean;
  }
): Promise<void> {
  try {
    const suffix =
      String(input.dedupeSuffix ?? "").trim() ||
      `${input.status}:${input.reason ?? "none"}`;
    const subjectDedup = `identity:${input.subjectType}:${input.subjectUserId}:${suffix}`;

    if (await wasAlreadyLogged(supabase, subjectDedup)) {
      return;
    }

    const { title, body } = copyFor(input.status, input.reason);
    const data = {
      channel: "identity",
      type: "identity_status",
      subject_type: input.subjectType,
      status: input.status,
      reason: input.reason ?? null,
    };

    const tokens = await loadTokens(supabase, input.subjectUserId);
    let status = "queued";
    let errorMessage: string | null = null;
    let sentAt: string | null = null;

    if (tokens.length === 0) {
      status = "failed";
      errorMessage = "no_tokens";
    } else {
      const sendResult = await sendExpo(
        tokens.map((to) => ({
          to,
          title,
          body,
          data,
          sound: "default",
          priority: "high",
        }))
      );
      status = sendResult.ok ? "sent" : "failed";
      errorMessage = sendResult.ok ? null : sendResult.error ?? "push_failed";
      sentAt = sendResult.ok ? new Date().toISOString() : null;
    }

    const { error: insertError } = await supabase.from("notification_logs").insert({
      user_id: input.subjectUserId,
      role: input.subjectType,
      title,
      body,
      data,
      status,
      error_message: errorMessage,
      dedup_key: subjectDedup,
      sent_at: sentAt,
    });

    if (insertError) {
      const code = String((insertError as { code?: string }).code ?? "");
      if (code !== "23505") {
        console.warn("[identityVerification.notify] insert failed", insertError);
      }
      return;
    }

    if (!input.notifyAdmins) return;

    const adminDedup = `identity:admin:${input.subjectType}:${input.subjectUserId}:${suffix}`;
    if (await wasAlreadyLogged(supabase, adminDedup)) return;

    const { error: adminInsertError } = await supabase.from("notification_logs").insert({
      user_id: null,
      role: "admin",
      title: `Identity ${input.status}: ${input.subjectType}`,
      body: `User ${input.subjectUserId} → ${input.status}`,
      data: {
        ...data,
        subject_user_id: input.subjectUserId,
        admin_alert: true,
      },
      status: "queued",
      dedup_key: adminDedup,
      sent_at: null,
    });

    if (adminInsertError) {
      const code = String((adminInsertError as { code?: string }).code ?? "");
      if (code !== "23505") {
        console.warn("[identityVerification.notify] admin insert failed", adminInsertError);
      }
    }
  } catch (error) {
    console.warn("[identityVerification.notify] failed", error);
  }
}
