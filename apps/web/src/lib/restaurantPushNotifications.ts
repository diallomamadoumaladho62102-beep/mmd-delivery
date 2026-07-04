import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePushSound } from "./mmdPushSounds";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

async function loadRestaurantTokens(
  supabaseAdmin: SupabaseClient,
  restaurantUserId: string,
): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("user_push_tokens")
    .select("expo_push_token,disabled,is_active")
    .eq("user_id", restaurantUserId)
    .eq("role", "restaurant");

  if (error) return [];

  return (data ?? [])
    .filter((row) => row.disabled !== true && row.is_active !== false)
    .map((row) => String(row.expo_push_token ?? "").trim())
    .filter((token) => token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken["));
}

async function sendExpo(messages: Array<Record<string, unknown>>) {
  if (messages.length === 0) return;
  try {
    await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });
  } catch (error) {
    console.log("[restaurantPush] send failed:", error);
  }
}

export async function notifyRestaurantNewPaidOrder(params: {
  supabaseAdmin: SupabaseClient;
  restaurantUserId: string;
  orderId: string;
}): Promise<void> {
  if (!params.restaurantUserId) return;

  const tokens = await loadRestaurantTokens(params.supabaseAdmin, params.restaurantUserId);
  if (tokens.length === 0) return;

  const data = {
    type: "restaurant_new_order",
    order_id: params.orderId,
  };

  await sendExpo(
    tokens.map((to) => ({
      to,
      sound: resolvePushSound("restaurant_new_order"),
      title: "Nouvelle commande",
      body: "Une commande payée vient d'arriver.",
      data,
      priority: "high",
    })),
  );
}
