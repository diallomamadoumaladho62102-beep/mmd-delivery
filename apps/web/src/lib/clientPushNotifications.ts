import type { SupabaseClient } from "@supabase/supabase-js";

import { resolvePushSound } from "./mmdPushSounds";

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

  const data = {
    type: "order_paid",
    order_id: params.orderId,
    kind: params.kind ?? "food",
  };

  const messages = tokens.map((to) => ({
    to,
    sound: resolvePushSound(data.type),
    title: "Commande confirmée",
    body: "Votre paiement a été reçu. Nous préparons votre commande.",
    data,
    priority: "high",
  }));

  await sendExpoPushMessages(messages);
}

export async function notifyClientOrderAccepted(params: {
  supabaseAdmin: SupabaseClient;
  userIds: Array<string | null | undefined>;
  orderId: string;
  prepMinutes?: number | null;
}): Promise<void> {
  const userIds = dedupeStrings(params.userIds);
  const tokens = await loadClientExpoTokens(params.supabaseAdmin, userIds);
  if (tokens.length === 0) return;

  const prepText =
    params.prepMinutes && params.prepMinutes > 0
      ? ` Temps de préparation estimé : ${params.prepMinutes} min.`
      : "";

  const data = {
    type: "order_accepted",
    order_id: params.orderId,
    prep_minutes: params.prepMinutes ?? null,
  };

  const messages = tokens.map((to) => ({
    to,
    sound: resolvePushSound(data.type),
    title: "Commande acceptée",
    body: `Le restaurant a accepté votre commande.${prepText}`,
    data,
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

  const data = {
    type: "delivery_request_paid",
    delivery_request_id: params.deliveryRequestId,
  };

  const messages = tokens.map((to) => ({
    to,
    sound: resolvePushSound(data.type),
    title: "Livraison confirmée",
    body: "Votre demande de livraison est payée. Recherche d'un chauffeur en cours.",
    data,
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

  const data = {
    type: "order_cancelled",
    order_id: params.orderId,
    refund: params.refund,
  };

  const messages = tokens.map((to) => ({
    to,
    sound: resolvePushSound(data.type),
    title: "Commande annulée",
    body,
    data,
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

  const data = {
    type: "delivery_request_cancelled",
    delivery_request_id: params.deliveryRequestId,
    refund: params.refund,
  };

  const messages = tokens.map((to) => ({
    to,
    sound: resolvePushSound(data.type),
    title: "Livraison annulée",
    body,
    data,
    priority: "high",
  }));

  await sendExpoPushMessages(messages);
}

export async function notifyClientDriverArrived(params: {
  supabaseAdmin: SupabaseClient;
  userIds: Array<string | null | undefined>;
  entityType: string;
  entityId: string;
  entityKind: "delivery" | "taxi";
}): Promise<void> {
  const userIds = dedupeStrings(params.userIds);
  const tokens = await loadClientExpoTokens(params.supabaseAdmin, userIds);
  if (tokens.length === 0) return;

  const label = params.entityKind === "taxi" ? "chauffeur" : "livreur";
  const data = {
    type: "driver_arrived",
    entity_type: params.entityType,
    entity_id: params.entityId,
  };

  const messages = tokens.map((to) => ({
    to,
    sound: resolvePushSound(data.type),
    title: "Arrivée sur place",
    body: `Votre ${label} est arrivé. Vous avez 5 minutes d'attente gratuite.`,
    data,
    priority: "high",
  }));

  await sendExpoPushMessages(messages);
}

export async function notifyClientWaitFeeStarted(params: {
  supabaseAdmin: SupabaseClient;
  userIds: Array<string | null | undefined>;
  entityType: string;
  entityId: string;
}): Promise<void> {
  const userIds = dedupeStrings(params.userIds);
  const tokens = await loadClientExpoTokens(params.supabaseAdmin, userIds);
  if (tokens.length === 0) return;

  const data = {
    type: "wait_fee_started",
    entity_type: params.entityType,
    entity_id: params.entityId,
  };

  const messages = tokens.map((to) => ({
    to,
    sound: resolvePushSound(data.type),
    title: "Frais de retard",
    body: "Les frais de retard commencent maintenant.",
    data,
    priority: "high",
  }));

  await sendExpoPushMessages(messages);
}

export async function notifyClientWaitFinalWarning(params: {
  supabaseAdmin: SupabaseClient;
  userIds: Array<string | null | undefined>;
  entityType: string;
  entityId: string;
  entityKind: "delivery" | "taxi";
}): Promise<void> {
  const userIds = dedupeStrings(params.userIds);
  const tokens = await loadClientExpoTokens(params.supabaseAdmin, userIds);
  if (tokens.length === 0) return;

  const body =
    params.entityKind === "taxi"
      ? "Votre temps d'attente gratuit est terminé. Veuillez rejoindre votre chauffeur."
      : "Votre temps d'attente gratuit est terminé. Veuillez récupérer votre commande ou rejoindre votre livreur.";

  const data = {
    type: "wait_final_warning",
    entity_type: params.entityType,
    entity_id: params.entityId,
  };

  const messages = tokens.map((to) => ({
    to,
    sound: resolvePushSound(data.type),
    title: "Temps d'attente écoulé",
    body,
    data,
    priority: "high",
  }));

  await sendExpoPushMessages(messages);
}
