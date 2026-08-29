import type { SupabaseClient } from "@supabase/supabase-js";

export type ChatPushTargetResult =
  | { ok: true; targetUserId: string }
  | { ok: false; error: "forbidden" | "invalid_target" | "access_check_failed" };

async function isOrderParticipant(
  supabaseAdmin: SupabaseClient,
  orderId: string,
  userId: string
): Promise<{ ok: true; allowed: boolean } | { ok: false }> {
  const { data, error } = await supabaseAdmin.rpc("is_order_message_participant", {
    p_resource_id: orderId,
    p_user_id: userId,
  });
  if (error) return { ok: false };
  return { ok: true, allowed: Boolean(data) };
}

/**
 * Push/badge targets must be real participants of the same order/ride.
 * Client-supplied targetUserId is never trusted alone.
 */
export async function resolveAuthorizedChatPushTarget(params: {
  supabaseAdmin: SupabaseClient;
  orderId: string;
  senderUserId: string;
  targetUserId?: string | null;
}): Promise<ChatPushTargetResult | { ok: true; targetUserId: null }> {
  const targetUserId = String(params.targetUserId ?? "").trim();
  if (!targetUserId) {
    return { ok: true, targetUserId: null };
  }

  const sender = await isOrderParticipant(
    params.supabaseAdmin,
    params.orderId,
    params.senderUserId
  );
  if (!sender.ok) return { ok: false, error: "access_check_failed" };
  if (!sender.allowed) return { ok: false, error: "forbidden" };

  const target = await isOrderParticipant(
    params.supabaseAdmin,
    params.orderId,
    targetUserId
  );
  if (!target.ok) return { ok: false, error: "access_check_failed" };
  if (!target.allowed) return { ok: false, error: "invalid_target" };

  return { ok: true, targetUserId };
}
