import type { SupabaseClient } from "@supabase/supabase-js";

export async function getUserPushBadgeCount(
  admin: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data, error } = await admin.rpc("get_user_push_badge_count", {
    p_user_id: userId,
  });

  if (error) {
    console.log("[pushBadge] count lookup failed:", error.message);
    return 0;
  }

  const count = Number(data ?? 0);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

export async function adjustUserPushBadge(
  admin: SupabaseClient,
  userId: string,
  delta: number,
): Promise<number> {
  const { data, error } = await admin.rpc("adjust_user_push_badge", {
    p_user_id: userId,
    p_delta: delta,
  });

  if (error) {
    console.log("[pushBadge] adjust failed:", error.message);
    return 0;
  }

  const count = Number(data ?? 0);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
}

export async function resetUserPushBadge(
  admin: SupabaseClient,
  userId: string,
): Promise<number> {
  const current = await getUserPushBadgeCount(admin, userId);
  if (current <= 0) return 0;
  return adjustUserPushBadge(admin, userId, -current);
}
