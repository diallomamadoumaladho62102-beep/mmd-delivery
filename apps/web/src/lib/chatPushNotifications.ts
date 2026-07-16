import type { SupabaseClient } from "@supabase/supabase-js";

import { resolvePushSound } from "./mmdPushSounds";
import { getUserPushBadgeCount } from "./pushBadgeService";

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
): Promise<string[]> {
  const { data, error } = await admin
    .from("user_push_tokens")
    .select("expo_push_token,disabled,is_active")
    .eq("user_id", userId)
    .eq("role", role);

  if (error) return [];

  return Array.from(
    new Set(
      (data ?? [])
        .filter((row) => row.disabled !== true && row.is_active !== false)
        .map((row) => String(row.expo_push_token ?? "").trim())
        .filter(isExpoPushToken),
    ),
  );
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

  const preview = String(params.preview ?? "Nouveau message").trim() || "Nouveau message";
  const data = {
    type: "order_message",
    order_id: params.orderId,
    orderId: params.orderId,
    sender_user_id: params.senderUserId,
    target_role: params.targetRole,
  };

  const messages = tokens.map((to) => ({
    to,
    sound: resolvePushSound("order_message"),
    title: "Nouveau message",
    body: preview.slice(0, 180),
    data,
    priority: "high",
    badge: badgeCount > 0 ? badgeCount : 1,
  }));

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
    title: "Nouveau message",
    body: preview.slice(0, 500),
    data,
    status,
    error_message: errorMessage,
    dedup_key: dedupKey,
    sent_at: status === "sent" ? new Date().toISOString() : null,
  });

  return { sent: status === "sent" ? tokens.length : 0 };
}
