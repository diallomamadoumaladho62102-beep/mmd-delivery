import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RESTAURANT_ORDERS_PUSH_CHANNEL,
  normalizePushPlatform,
  resolvePushSoundForPlatform,
} from "./mmdPushSounds";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const DEDUP_WINDOW_MS = 10 * 60 * 1000;

function isExpoPushToken(value: unknown): value is string {
  const s = String(value ?? "").trim();
  return (
    s.startsWith("ExponentPushToken[") || s.startsWith("ExpoPushToken[")
  );
}

export function restaurantNewOrderDedupKey(orderId: string): string {
  return `restaurant_new_order:${String(orderId).trim()}`;
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
    console.log("[restaurantPush] dedup lookup failed:", error.message);
    return false;
  }

  return (data ?? []).length > 0;
}

type TokenRow = {
  expo_push_token: string;
  platform?: string | null;
};

async function loadRestaurantTokens(
  supabaseAdmin: SupabaseClient,
  restaurantUserId: string,
): Promise<TokenRow[]> {
  // Live DB columns for this table are narrower than some migrations;
  // only select fields known to exist in production.
  const { data, error } = await supabaseAdmin
    .from("user_push_tokens")
    .select("expo_push_token,platform")
    .eq("user_id", restaurantUserId)
    .eq("role", "restaurant");

  if (error) {
    console.log("[restaurantPush] token lookup failed:", error.message);
    return [];
  }

  const byToken = new Map<string, TokenRow>();
  for (const row of data ?? []) {
    const expo_push_token = String(row.expo_push_token ?? "").trim();
    if (!isExpoPushToken(expo_push_token)) continue;
    // Prefer the latest row for a duplicated token (query order is undefined).
    byToken.set(expo_push_token, {
      expo_push_token,
      platform: row.platform ?? null,
    });
  }
  return [...byToken.values()];
}

async function sendExpo(messages: Array<Record<string, unknown>>) {
  if (messages.length === 0) return { ok: true as const };
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
      const text = await response.text().catch(() => "push_failed");
      return { ok: false as const, error: text };
    }
    return { ok: true as const };
  } catch (error) {
    console.log("[restaurantPush] send failed:", error);
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "push_error",
    };
  }
}

export async function notifyRestaurantNewPaidOrder(params: {
  supabaseAdmin: SupabaseClient;
  restaurantUserId: string;
  orderId: string;
}): Promise<{ sent: number; skipped?: string }> {
  const restaurantUserId = String(params.restaurantUserId ?? "").trim();
  const orderId = String(params.orderId ?? "").trim();
  if (!restaurantUserId || !orderId) {
    return { sent: 0, skipped: "missing_ids" };
  }

  const dedupKey = restaurantNewOrderDedupKey(orderId);
  if (await wasRecentlySent(params.supabaseAdmin, dedupKey)) {
    return { sent: 0, skipped: "dedup" };
  }

  const tokens = await loadRestaurantTokens(
    params.supabaseAdmin,
    restaurantUserId,
  );
  if (tokens.length === 0) {
    await params.supabaseAdmin.from("notification_logs").insert({
      user_id: restaurantUserId,
      role: "restaurant",
      title: "Nouvelle commande",
      body: "Une commande payée vient d'arriver.",
      data: { type: "restaurant_new_order", order_id: orderId },
      status: "failed",
      error_message: "no_tokens",
      dedup_key: dedupKey,
      sent_at: null,
    });
    return { sent: 0, skipped: "no_tokens" };
  }

  const data = {
    type: "restaurant_new_order",
    order_id: orderId,
    orderId,
  };

  const messages = tokens.map((row) => {
    const platform = normalizePushPlatform(row.platform);
    return {
      to: row.expo_push_token,
      sound: resolvePushSoundForPlatform("restaurant_new_order", row.platform),
      title: "Nouvelle commande",
      body: "Une commande payée vient d'arriver.",
      data,
      priority: "high" as const,
      channelId:
        platform === "android" || platform === "unknown"
          ? RESTAURANT_ORDERS_PUSH_CHANNEL
          : undefined,
      _contentAvailable: true,
    };
  });

  const sendResult = await sendExpo(messages);
  const status = sendResult.ok ? "sent" : "failed";

  await params.supabaseAdmin.from("notification_logs").insert({
    user_id: restaurantUserId,
    role: "restaurant",
    title: "Nouvelle commande",
    body: "Une commande payée vient d'arriver.",
    data,
    status,
    error_message: sendResult.ok ? null : sendResult.error ?? "push_failed",
    dedup_key: dedupKey,
    sent_at: status === "sent" ? new Date().toISOString() : null,
  });

  return {
    sent: status === "sent" ? tokens.length : 0,
    skipped: status === "sent" ? undefined : "send_failed",
  };
}
