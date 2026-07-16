import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePushSound } from "./mmdPushSounds";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

function dedupe(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
}

async function loadTokens(
  supabaseAdmin: SupabaseClient,
  userIds: string[],
  role?: string
): Promise<string[]> {
  if (userIds.length === 0) return [];
  let query = supabaseAdmin
    .from("user_push_tokens")
    .select("expo_push_token,disabled,is_active,user_id,role")
    .in("user_id", userIds);

  if (role) query = query.eq("role", role);

  const { data, error } = await query;
  if (error) return [];

  return (data ?? [])
    .filter((row) => row.disabled !== true && row.is_active !== false)
    .map((row) => String(row.expo_push_token ?? "").trim())
    .filter(
      (token) =>
        token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[")
    );
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
    console.log("[marketplacePush] send failed:", error);
  }
}

export async function notifyMarketplaceSellerNewPaidOrder(params: {
  supabaseAdmin: SupabaseClient;
  sellerUserId: string;
  orderId: string;
}): Promise<void> {
  if (!params.sellerUserId) return;
  const tokens = await loadTokens(params.supabaseAdmin, [params.sellerUserId]);
  if (tokens.length === 0) return;

  const data = {
    type: "marketplace_new_order",
    seller_order_id: params.orderId,
  };

  await sendExpo(
    tokens.map((to) => ({
      to,
      sound: resolvePushSound("restaurant_new_order"),
      title: "Nouvelle commande Marketplace",
      body: "Une commande payée vient d'arriver.",
      data,
      priority: "high",
    }))
  );
}

export async function notifyMarketplaceClientOrderStatus(params: {
  supabaseAdmin: SupabaseClient;
  clientUserId: string | null | undefined;
  orderId: string;
  status: string;
}): Promise<void> {
  const userIds = dedupe([params.clientUserId]);
  if (userIds.length === 0) return;
  const tokens = await loadTokens(params.supabaseAdmin, userIds, "client");
  if (tokens.length === 0) return;

  const status = String(params.status);
  const title =
    status === "accepted"
      ? "Commande acceptée"
      : status === "refused"
        ? "Commande refusée"
        : status === "preparing"
          ? "Commande en préparation"
          : status === "ready"
            ? "Commande prête"
            : status === "out_for_delivery"
              ? "Commande en livraison"
              : status === "canceled" || status === "cancelled"
                ? "Commande annulée"
                : "Mise à jour commande";

  const body =
    status === "refused"
      ? "Le vendeur a refusé votre commande. Un remboursement différé est enregistré."
      : `Statut Marketplace : ${status}.`;

  const data = {
    type: "marketplace_order_update",
    seller_order_id: params.orderId,
    status,
  };

  await sendExpo(
    tokens.map((to) => ({
      to,
      sound: resolvePushSound(
        status === "accepted"
          ? "order_accepted"
          : status === "refused" || status === "canceled" || status === "cancelled"
            ? "order_cancelled"
            : "client_update"
      ),
      title,
      body,
      data,
      priority: "high",
    }))
  );
}
