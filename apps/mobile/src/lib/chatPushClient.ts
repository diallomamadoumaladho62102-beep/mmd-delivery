import { API_BASE_URL } from "./apiBase";
import { supabase } from "./supabase";

type ChatPushRole = "client" | "driver" | "restaurant" | "seller";

type FireOrderChatPushParams = {
  orderId: string;
  targetUserId: string;
  targetRole: ChatPushRole;
  preview?: string | null;
};

const BASE_URL = String(API_BASE_URL ?? "").replace(/\/+$/, "");

/** Fire-and-forget chat push after a successful message insert. */
export async function fireOrderChatPushNotify(
  params: FireOrderChatPushParams,
): Promise<void> {
  try {
    if (!BASE_URL) return;
    if (!params.orderId || !params.targetUserId || !params.targetRole) return;

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const token = session?.access_token;
    if (!token) return;

    void fetch(`${BASE_URL}/api/chat/push-notify`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderId: params.orderId,
        targetUserId: params.targetUserId,
        targetRole: params.targetRole,
        preview: params.preview ?? null,
      }),
    }).catch(() => undefined);
  } catch {
    // best-effort only
  }
}
