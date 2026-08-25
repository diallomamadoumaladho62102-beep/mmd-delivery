import type { SupabaseClient } from "@supabase/supabase-js";

import { resolvePushSound } from "./mmdPushSounds";
import { getUserPushBadgeCount } from "./pushBadgeService";
import { pushText } from "./pushCopy";
import { normalizeAppLocale, type AppLocale } from "./userLocale";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const DEDUP_WINDOW_MS = 120_000;

export type ChatPushRole = "client" | "driver" | "restaurant" | "seller";

export type OrderChatPushParams = {
  supabaseAdmin: SupabaseClient;
  orderId: string;
  senderUserId: string;
  targetUserId: string;
  targetRole: ChatPushRole;
  preview?: string | null;
};

function isExpoPushToken(value: unknown): value is string {
  const s = String(value ?? "").trim();
  return (
    s.startsWith("ExponentPushToken[") || s.startsWith("ExpoPushToken[")
  );
}

function buildDedupKey(params: OrderChatPushParams): string {
  const preview = String(params.preview ?? "").trim().slice(0, 64);
  return `chat:${params.orderId}:${params.senderUserId}:${params.targetUserId}:${preview}`;
}

async function wasRecentlySent(
  admin: SupabaseClient,
  dedupKey: string,
): Promise<boolean> {
  const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
  const { data, error } = await admin
    .from("notification_logs")
    .select("id")
    .eq("dedup_key", dedupKey)
    .eq("status", "sent")
    .gte("created_at", since)
    .limit(1);

  if (error) {
    console.log("[chatPush] dedup lookup failed:", error.message);
    return false;
  }

  return (data ?? []).length > 0;
}

async function loadTargetTokens(
  admin: SupabaseClient,
  userId: string,
  role: ChatPushRole,
): Promise<Array<{ token: string; locale: AppLocale }>> {
  const { data, error } = await admin
    .from("user_push_tokens")
    .select("expo_push_token,disabled,is_active,locale")
    .eq("user_id", userId)
    .eq("role", role);

  if (error) return [];

  const seen = new Set<string>();
  const out: Array<{ token: string; locale: AppLocale }> = [];
  for (const row of data ?? []) {
    if (row.disabled === true || row.is_active === false) continue;
    const token = String(row.expo_push_token ?? "").trim();
    if (!isExpoPushToken(token) || seen.has(token)) continue;
    seen.add(token);
    out.push({ token, locale: normalizeAppLocale((row as { locale?: unknown }).locale) });
  }
  return out;
}

export async function notifyOrderChatMessage(
  params: OrderChatPushParams,
): Promise<{ sent: number; skipped?: string }> {
  const dedupKey = buildDedupKey(params);

  if (await wasRecentlySent(params.supabaseAdmin, dedupKey)) {
    return { sent: 0, skipped: "dedup" };
  }

  const tokens = await loadTargetTokens(
    params.supabaseAdmin,
    params.targetUserId,
    params.targetRole,
  );

  if (tokens.length === 0) {
    return { sent: 0, skipped: "no_tokens" };
  }

  const badgeCount = await getUserPushBadgeCount(
    params.supabaseAdmin,
    params.targetUserId,
  );

  const previewRaw = String(params.preview ?? "").trim();
  const data = {
    type: "order_message",
    order_id: params.orderId,
    orderId: params.orderId,
    sender_user_id: params.senderUserId,
    target_role: params.targetRole,
  };

  const messages = tokens.map((target) => {
    const copy = pushText("new_message", target.locale, {
      preview: previewRaw,
    });
    return {
      to: target.token,
      sound: resolvePushSound("order_message"),
      title: copy.title,
      body: (previewRaw || copy.title).slice(0, 180),
      data,
      priority: "high",
      badge: badgeCount > 0 ? badgeCount : 1,
    };
  });

  let status = "sent";
  let errorMessage: string | null = null;

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
      status = "failed";
      errorMessage = await response.text().catch(() => "push_failed");
    }
  } catch (error) {
    status = "failed";
    errorMessage = error instanceof Error ? error.message : "push_error";
  }

  await params.supabaseAdmin.from("notification_logs").insert({
    user_id: params.targetUserId,
    role: params.targetRole,
    title: messages[0]?.title ?? pushText("new_message", "en").title,
    body: (previewRaw || messages[0]?.title || "").slice(0, 500),
    data,
    status,
    error_message: errorMessage,
    dedup_key: dedupKey,
    sent_at: status === "sent" ? new Date().toISOString() : null,
  });

  return { sent: status === "sent" ? tokens.length : 0 };
}
