import { supabase } from "@/lib/supabaseBrowser";

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
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
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "not_authenticated" };

  const response = await fetch("/api/chat/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
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
}): Promise<void> {
  const token = await getAccessToken();
  if (!token) return;

  await fetch("/api/chat/messages", {
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
  }).catch(() => undefined);
}

export async function markChatMessageDeliveredViaApi(messageId: string): Promise<void> {
  const token = await getAccessToken();
  if (!token || !messageId) return;

  void fetch("/api/chat/messages", {
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
