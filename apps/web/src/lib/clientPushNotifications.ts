import type { SupabaseClient } from "@supabase/supabase-js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

type PushTokenRow = {
  expo_push_token?: string | null;
  push_token?: string | null;
  token?: string | null;
  disabled?: boolean | null;
  is_active?: boolean | null;
};

function isExpoPushToken(value: unknown): value is string {
  const s = String(value ?? "").trim();
  return (
    s.startsWith("ExponentPushToken[") || s.startsWith("ExpoPushToken[")
  );
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean))
  );
}

async function loadClientExpoTokens(
  supabaseAdmin: SupabaseClient,
  userIds: string[]
): Promise<string[]> {
  if (userIds.length === 0) return [];

  const { data: tokenRows, error } = await supabaseAdmin
    .from("user_push_tokens")
    .select("*")
    .in("user_id", userIds);

  if (error) {
    console.log("[clientPush] token lookup failed:", error.message);
    return [];
  }

  return dedupeStrings(
    ((tokenRows ?? []) as PushTokenRow[])
      .filter((row) => row.disabled !== true && row.is_active !== false)
      .map((row) => row.expo_push_token ?? row.push_token ?? row.token ?? null)
      .filter(isExpoPushToken)
  );
}

async function sendExpoPushMessages(
  messages: Array<Record<string, unknown>>
): Promise<void> {
  if (messages.length === 0) return;

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
      const text = await response.text().catch(() => "");
      console.log("[clientPush] expo push failed:", response.status, text);
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.log("[clientPush] expo push error:", message);
  }
}

export async function notifyClientOrderCreated(params: {
  supabaseAdmin: SupabaseClient;
  userIds: Array<string | null | undefined>;
  orderId: string;
  kind?: string | null;
}): Promise<void> {
  const userIds = dedupeStrings(params.userIds);
  const tokens = await loadClientExpoTokens(params.supabaseAdmin, userIds);

  if (tokens.length === 0) return;

  const messages = tokens.map((to) => ({
    to,
    sound: "default",
    title: "Commande confirmée",
    body: "Votre paiement a été reçu. Nous préparons votre commande.",
    data: {
      type: "order_paid",
      order_id: params.orderId,
      kind: params.kind ?? "food",
    },
    priority: "high",
  }));

  await sendExpoPushMessages(messages);
}

export async function notifyClientDeliveryRequestPaid(params: {
  supabaseAdmin: SupabaseClient;
  userIds: Array<string | null | undefined>;
  deliveryRequestId: string;
}): Promise<void> {
  const userIds = dedupeStrings(params.userIds);
  const tokens = await loadClientExpoTokens(params.supabaseAdmin, userIds);

  if (tokens.length === 0) return;

  const messages = tokens.map((to) => ({
    to,
    sound: "default",
    title: "Livraison confirmée",
    body: "Votre demande de livraison est payée. Recherche d'un chauffeur en cours.",
    data: {
      type: "delivery_request_paid",
      delivery_request_id: params.deliveryRequestId,
    },
    priority: "high",
  }));

  await sendExpoPushMessages(messages);
}

export async function notifyClientOrderCancelled(params: {
  supabaseAdmin: SupabaseClient;
  userIds: Array<string | null | undefined>;
  orderId: string;
  refund: "FULL" | "NONE" | "NOT_APPLICABLE";
}): Promise<void> {
  const userIds = dedupeStrings(params.userIds);
  const tokens = await loadClientExpoTokens(params.supabaseAdmin, userIds);

  if (tokens.length === 0) return;

  const body =
    params.refund === "FULL"
      ? "Votre commande a été annulée. Un remboursement est en cours."
      : "Votre commande a été annulée.";

  const messages = tokens.map((to) => ({
    to,
    sound: "default",
    title: "Commande annulée",
    body,
    data: {
      type: "order_cancelled",
      order_id: params.orderId,
      refund: params.refund,
    },
    priority: "high",
  }));

  await sendExpoPushMessages(messages);
}

export async function notifyClientDeliveryRequestCancelled(params: {
  supabaseAdmin: SupabaseClient;
  userIds: Array<string | null | undefined>;
  deliveryRequestId: string;
  refund: "FULL" | "NONE";
}): Promise<void> {
  const userIds = dedupeStrings(params.userIds);
  const tokens = await loadClientExpoTokens(params.supabaseAdmin, userIds);

  if (tokens.length === 0) return;

  const body =
    params.refund === "FULL"
      ? "Votre livraison a été annulée. Un remboursement est en cours."
      : "Votre livraison a été annulée.";

  const messages = tokens.map((to) => ({
    to,
    sound: "default",
    title: "Livraison annulée",
    body,
    data: {
      type: "delivery_request_cancelled",
      delivery_request_id: params.deliveryRequestId,
      refund: params.refund,
    },
    priority: "high",
  }));

  await sendExpoPushMessages(messages);
}
