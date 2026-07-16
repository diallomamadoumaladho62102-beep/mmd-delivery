import type { SupabaseClient } from "@supabase/supabase-js";

import { checkRateLimit } from "@/lib/apiRateLimit";
import { notifyOrderChatMessage, type ChatPushRole } from "@/lib/chatPushNotifications";
import { adjustUserPushBadge } from "@/lib/pushBadgeService";

export type SendOrderChatMessageInput = {
  orderId: string;
  text?: string | null;
  imagePath?: string | null;
  senderRole?: string | null;
  targetRole?: string | null;
  targetUserId?: string | null;
};

export type SendOrderChatMessageResult = {
  ok: boolean;
  error?: string;
  message?: Record<string, unknown>;
};

const CHAT_PUSH_ROLES: ChatPushRole[] = [
  "client",
  "driver",
  "restaurant",
  "seller",
];

function isChatPushRole(value: unknown): value is ChatPushRole {
  return (
    typeof value === "string" &&
    CHAT_PUSH_ROLES.includes(value as ChatPushRole)
  );
}

export async function sendOrderChatMessageViaRpc(
  supabaseUserClient: SupabaseClient,
  input: SendOrderChatMessageInput,
  rateKey: string,
): Promise<SendOrderChatMessageResult> {
  const rate = checkRateLimit({
    namespace: "chat-message-send",
    key: rateKey,
    limit: 30,
    windowMs: 60_000,
  });

  if (rate.limited) {
    return { ok: false, error: "rate_limited" };
  }

  const { data, error } = await supabaseUserClient.rpc("send_order_message", {
    p_order_id: input.orderId,
    p_text: input.text ?? null,
    p_image_path: input.imagePath ?? null,
    p_sender_role: input.senderRole ?? null,
    p_target_role: input.targetRole ?? null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const payload = (data ?? null) as {
    ok?: boolean;
    error?: string;
    message?: Record<string, unknown>;
  } | null;

  if (!payload?.ok) {
    return { ok: false, error: payload?.error ?? "send_failed" };
  }

  return { ok: true, message: payload.message ?? undefined };
}

export async function afterOrderChatMessageSent(params: {
  supabaseAdmin: SupabaseClient;
  orderId: string;
  senderUserId: string;
  targetUserId?: string | null;
  targetRole?: string | null;
  preview?: string | null;
}): Promise<void> {
  const targetUserId = String(params.targetUserId ?? "").trim();
  let targetRole = String(params.targetRole ?? "").trim();

  if (targetUserId) {
    const { data: profile } = await params.supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", targetUserId)
      .maybeSingle();

    const profileRole = String((profile as { role?: string } | null)?.role ?? "")
      .trim()
      .toLowerCase();

    if (profileRole === "seller") {
      targetRole = "seller";
    }
  }

  if (targetUserId) {
    await adjustUserPushBadge(params.supabaseAdmin, targetUserId, 1);
  }

  if (targetUserId && isChatPushRole(targetRole)) {
    await notifyOrderChatMessage({
      supabaseAdmin: params.supabaseAdmin,
      orderId: params.orderId,
      senderUserId: params.senderUserId,
      targetUserId,
      targetRole,
      preview: params.preview,
    });
  }
}

export async function markOrderMessagesRead(
  supabaseUserClient: SupabaseClient,
  orderId: string,
  targetRole?: string | null,
): Promise<{ ok: boolean; marked?: number; error?: string }> {
  const { data, error } = await supabaseUserClient.rpc("mark_order_messages_read", {
    p_order_id: orderId,
    p_target_role: targetRole ?? null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const payload = (data ?? null) as {
    ok?: boolean;
    marked?: number;
    error?: string;
  } | null;

  return {
    ok: Boolean(payload?.ok),
    marked: payload?.marked,
    error: payload?.error,
  };
}

export async function markOrderMessageDelivered(
  supabaseUserClient: SupabaseClient,
  messageId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabaseUserClient.rpc(
    "mark_order_message_delivered",
    { p_message_id: messageId },
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  const payload = (data ?? null) as { ok?: boolean; error?: string } | null;
  return { ok: Boolean(payload?.ok), error: payload?.error };
}
