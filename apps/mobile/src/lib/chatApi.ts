import * as Notifications from "expo-notifications";

import { supabase } from "./supabase";
import { API_BASE_URL } from "./apiBase";

const BASE_URL = String(API_BASE_URL ?? "").replace(/\/+$/, "");

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export async function setAppBadgeCount(count: number): Promise<void> {
  try {
    const safe = Math.max(0, Math.floor(Number(count) || 0));
    await Notifications.setBadgeCountAsync(safe);
  } catch (error) {
    console.log("setAppBadgeCount error:", error);
  }
}

export async function clearAppBadgeCount(): Promise<void> {
  await setAppBadgeCount(0);
}

export async function syncAppBadgeFromServer(): Promise<number> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) {
      await clearAppBadgeCount();
      return 0;
    }

    const { data, error } = await supabase
      .from("user_push_badge_counts")
      .select("unread_count")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.log("syncAppBadgeFromServer error:", error.message);
      return 0;
    }

    const count = Number((data as { unread_count?: number } | null)?.unread_count ?? 0);
    await setAppBadgeCount(count);
    return count;
  } catch (error) {
    console.log("syncAppBadgeFromServer fatal:", error);
    return 0;
  }
}

export type SendChatMessageInput = {
  orderId: string;
  text?: string | null;
  imagePath?: string | null;
  senderRole?: string | null;
  targetRole?: string | null;
  targetUserId?: string | null;
};

export async function sendChatMessageViaApi(
  input: SendChatMessageInput,
): Promise<{ ok: boolean; message?: Record<string, unknown>; error?: string }> {
  if (!BASE_URL) return { ok: false, error: "missing_api_base_url" };

  const token = await getAccessToken();
  if (!token) return { ok: false, error: "not_authenticated" };

  const response = await fetch(`${BASE_URL}/api/chat/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      orderId: input.orderId,
      text: input.text ?? null,
      imagePath: input.imagePath ?? null,
      senderRole: input.senderRole ?? null,
      targetRole: input.targetRole ?? null,
      targetUserId: input.targetUserId ?? null,
    }),
  });

  const json = (await response.json().catch(() => null)) as {
    ok?: boolean;
    message?: Record<string, unknown>;
    error?: string;
  } | null;

  if (!response.ok || !json?.ok) {
    return { ok: false, error: json?.error ?? "send_failed" };
  }

  return { ok: true, message: json.message };
}

export async function markChatMessagesReadViaApi(params: {
  orderId: string;
  targetRole?: string | null;
}): Promise<{ ok: boolean; badgeCount?: number }> {
  if (!BASE_URL) return { ok: false };

  const token = await getAccessToken();
  if (!token) return { ok: false };

  const response = await fetch(`${BASE_URL}/api/chat/messages`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "read",
      orderId: params.orderId,
      targetRole: params.targetRole ?? null,
    }),
  });

  const json = (await response.json().catch(() => null)) as {
    ok?: boolean;
    badgeCount?: number;
  } | null;

  if (json?.ok) {
    await setAppBadgeCount(Number(json.badgeCount ?? 0));
  }

  return { ok: Boolean(json?.ok), badgeCount: json?.badgeCount };
}

export async function markChatMessageDeliveredViaApi(
  messageId: string,
): Promise<void> {
  if (!BASE_URL || !messageId) return;

  const token = await getAccessToken();
  if (!token) return;

  void fetch(`${BASE_URL}/api/chat/messages`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "delivered",
      messageId,
    }),
  }).catch(() => undefined);
}
