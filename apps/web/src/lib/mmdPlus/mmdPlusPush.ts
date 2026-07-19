import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePushSound } from "@/lib/mmdPushSounds";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

function isExpoPushToken(value: unknown): value is string {
  const s = String(value ?? "").trim();
  return s.startsWith("ExponentPushToken[") || s.startsWith("ExpoPushToken[");
}

/** Lightweight client push for MMD+ lifecycle events (uses existing push tokens). */
export async function notifyClientGenericPush(params: {
  supabaseAdmin: SupabaseClient;
  userIds: Array<string | null | undefined>;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  const userIds = Array.from(
    new Set(params.userIds.map((v) => String(v ?? "").trim()).filter(Boolean))
  );
  if (userIds.length === 0) return;

  const { data: tokenRows, error } = await params.supabaseAdmin
    .from("user_push_tokens")
    .select("expo_push_token, push_token, token, disabled, is_active")
    .in("user_id", userIds);

  if (error) {
    console.warn("[mmd-plus-push] token lookup failed", error.message);
    return;
  }

  const tokens = Array.from(
    new Set(
      ((tokenRows ?? []) as Array<Record<string, unknown>>)
        .filter((row) => row.disabled !== true && row.is_active !== false)
        .map((row) =>
          String(row.expo_push_token ?? row.push_token ?? row.token ?? "").trim()
        )
        .filter(isExpoPushToken)
    )
  );

  if (tokens.length === 0) return;

  const data = { module: "mmd_plus", ...(params.data ?? {}) } as Record<
    string,
    unknown
  >;
  const messages = tokens.map((to) => ({
    to,
    sound: resolvePushSound(String(data.type ?? "mmd_plus")),
    title: params.title,
    body: params.body,
    data,
    priority: "high" as const,
  }));

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.warn("[mmd-plus-push] expo failed", response.status, text);
    }
  } catch (e) {
    console.warn("[mmd-plus-push] error", e instanceof Error ? e.message : e);
  }
}
