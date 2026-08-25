import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePushSound } from "./mmdPushSounds";
import { marketplaceOrderStatusKey, pushText } from "./pushCopy";
import { normalizeAppLocale, type AppLocale } from "./userLocale";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

function dedupe(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
}

type PushTarget = { token: string; locale: AppLocale };

async function loadTokens(
  supabaseAdmin: SupabaseClient,
  userIds: string[],
  role?: string
): Promise<PushTarget[]> {
  if (userIds.length === 0) return [];
  let query = supabaseAdmin
    .from("user_push_tokens")
    .select("expo_push_token,disabled,is_active,user_id,role,locale")
    .in("user_id", userIds);

  if (role) query = query.eq("role", role);

  const { data, error } = await query;
  if (error) return [];

  const seen = new Set<string>();
  const out: PushTarget[] = [];
  for (const row of data ?? []) {
    if (row.disabled === true || row.is_active === false) continue;
    const token = String(row.expo_push_token ?? "").trim();
    if (
      !(token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[")) ||
      seen.has(token)
    ) {
      continue;
    }
    seen.add(token);
    out.push({
      token,
      locale: normalizeAppLocale((row as { locale?: unknown }).locale),
    });
  }
  return out;
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
    tokens.map((target) => {
      const copy = pushText("new_marketplace_order", target.locale);
      return {
        to: target.token,
        sound: resolvePushSound("restaurant_new_order"),
        title: copy.title,
        body: copy.body,
        data,
        priority: "high",
      };
    }),
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
  const data = {
    type: "marketplace_order_update",
    seller_order_id: params.orderId,
    status,
  };

  await sendExpo(
    tokens.map((target) => {
      const copy = pushText(marketplaceOrderStatusKey(status), target.locale, {
        status,
      });
      return {
        to: target.token,
        sound: resolvePushSound(
          status === "accepted"
            ? "order_accepted"
            : status === "refused" || status === "canceled" || status === "cancelled"
              ? "order_cancelled"
              : "client_update",
        ),
        title: copy.title,
        body: copy.body,
        data,
        priority: "high",
      };
    }),
  );
}
