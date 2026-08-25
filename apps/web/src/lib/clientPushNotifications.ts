import type { SupabaseClient } from "@supabase/supabase-js";

import { resolvePushSound } from "./mmdPushSounds";
import { prepMinutesSuffix, pushText } from "./pushCopy";
import { normalizeAppLocale, type AppLocale } from "./userLocale";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

type PushTokenRow = {
  expo_push_token?: string | null;
  push_token?: string | null;
  token?: string | null;
  locale?: string | null;
  disabled?: boolean | null;
  is_active?: boolean | null;
};

type PushTarget = { token: string; locale: AppLocale };

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
): Promise<PushTarget[]> {
  if (userIds.length === 0) return [];

  const { data: tokenRows, error } = await supabaseAdmin
    .from("user_push_tokens")
    .select("*")
    .in("user_id", userIds);

  if (error) {
    console.log("[clientPush] token lookup failed:", error.message);
    return [];
  }

  const seen = new Set<string>();
  const out: PushTarget[] = [];
  for (const row of (tokenRows ?? []) as PushTokenRow[]) {
    if (row.disabled === true || row.is_active === false) continue;
    const token = row.expo_push_token ?? row.push_token ?? row.token ?? null;
    if (!isExpoPushToken(token) || seen.has(token)) continue;
    seen.add(token);
    out.push({ token, locale: normalizeAppLocale(row.locale) });
  }
  return out;
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

export function taxiRideAcceptedDedupKey(taxiRideId: string): string {
  return `taxi_ride_accepted:${String(taxiRideId).trim()}`;
}

export function taxiDriverArrivedDedupKey(
  entityType: string,
  entityId: string,
): string {
  return `taxi_driver_arrived:${String(entityType).trim()}:${String(entityId).trim()}`;
}

/** 3-minute ETA buckets — significant change only, no spam. */
export function taxiDriverEtaDedupKey(
  taxiRideId: string,
  etaMinutes: number,
): string {
  const bucket = Math.max(1, Math.round(etaMinutes / 3) * 3);
  return `taxi_driver_eta:${String(taxiRideId).trim()}:${bucket}`;
}

async function wasTaxiPushAlreadySent(
  supabaseAdmin: SupabaseClient,
  dedupKey: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("notification_logs")
    .select("id")
    .eq("dedup_key", dedupKey)
    .eq("status", "sent")
    .limit(1);

  if (error) {
    console.log("[clientPush] dedup lookup failed:", error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

async function logTaxiClientPush(params: {
  supabaseAdmin: SupabaseClient;
  userId: string | null | undefined;
  title: string;
  body: string;
  data: Record<string, unknown>;
  dedupKey: string;
  sent: boolean;
  errorMessage?: string | null;
}): Promise<void> {
  const { error } = await params.supabaseAdmin.from("notification_logs").insert({
    user_id: params.userId ?? null,
    role: "client",
    title: params.title,
    body: params.body,
    data: params.data,
    status: params.sent ? "sent" : "failed",
    error_message: params.sent ? null : params.errorMessage ?? "push_failed",
    dedup_key: params.dedupKey,
    sent_at: params.sent ? new Date().toISOString() : null,
  });
  if (error) {
    console.log("[clientPush] notification_logs insert failed:", error.message);
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

  const messages = tokens.map((target) => {
    const copy = pushText("order_confirmed", target.locale);
    return {
      to: target.token,
      sound: resolvePushSound(data.type),
      title: copy.title,
      body: copy.body,
      data,
      priority: "high",
    };
  });

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

  const data = {
    type: "order_accepted",
    order_id: params.orderId,
    prep_minutes: params.prepMinutes ?? null,
  };

  const messages = tokens.map((target) => {
    const copy = pushText("order_accepted", target.locale, {
      prep: prepMinutesSuffix(target.locale, params.prepMinutes ?? 0),
    });
    return {
      to: target.token,
      sound: resolvePushSound(data.type),
      title: copy.title,
      body: copy.body,
      data,
      priority: "high",
    };
  });

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

  const messages = tokens.map((target) => {
    const copy = pushText("delivery_confirmed", target.locale);
    return {
      to: target.token,
      sound: resolvePushSound(data.type),
      title: copy.title,
      body: copy.body,
      data,
      priority: "high",
    };
  });

  await sendExpoPushMessages(messages);
}

export async function notifyClientOrderCancelled(params: {
  supabaseAdmin: SupabaseClient;
  userIds: Array<string | null | undefined>;
  orderId: string;
  refund: "FULL" | "NONE" | "NOT_APPLICABLE" | "REQUIRED";
}): Promise<void> {
  const userIds = dedupeStrings(params.userIds);
  const tokens = await loadClientExpoTokens(params.supabaseAdmin, userIds);

  if (tokens.length === 0) return;

  const data = {
    type: "order_cancelled",
    order_id: params.orderId,
    refund: params.refund,
  };

  const messages = tokens.map((target) => {
    const copy = pushText(
      params.refund === "FULL" || params.refund === "REQUIRED"
        ? "order_cancelled_refund"
        : "order_cancelled",
      target.locale,
    );
    return {
      to: target.token,
      sound: resolvePushSound(data.type),
      title: copy.title,
      body: copy.body,
      data,
      priority: "high",
    };
  });

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

  const data = {
    type: "delivery_request_cancelled",
    delivery_request_id: params.deliveryRequestId,
    refund: params.refund,
  };

  const messages = tokens.map((target) => {
    const copy = pushText(
      params.refund === "FULL" ? "delivery_cancelled_refund" : "delivery_cancelled",
      target.locale,
    );
    return {
      to: target.token,
      sound: resolvePushSound(data.type),
      title: copy.title,
      body: copy.body,
      data,
      priority: "high",
    };
  });

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

  const dedupKey =
    params.entityKind === "taxi"
      ? taxiDriverArrivedDedupKey(params.entityType, params.entityId)
      : `driver_arrived:${params.entityType}:${params.entityId}`;
  if (await wasTaxiPushAlreadySent(params.supabaseAdmin, dedupKey)) {
    return;
  }

  const data = {
    type: "driver_arrived",
    entity_type: params.entityType,
    entity_id: params.entityId,
    ...(params.entityKind === "taxi"
      ? {
          taxi_ride_id: params.entityId,
          taxiRideId: params.entityId,
        }
      : {}),
  };

  const messages = tokens.map((target) => {
    const copy = pushText(
      params.entityKind === "taxi" ? "driver_arrived_taxi" : "driver_arrived_delivery",
      target.locale,
    );
    return {
      to: target.token,
      sound: resolvePushSound(data.type),
      title: copy.title,
      body: copy.body,
      data,
      priority: "high",
    };
  });

  await sendExpoPushMessages(messages);
  await logTaxiClientPush({
    supabaseAdmin: params.supabaseAdmin,
    userId: userIds[0] ?? null,
    title: messages[0]?.title ?? "",
    body: messages[0]?.body ?? "",
    data,
    dedupKey,
    sent: true,
  });
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

  const messages = tokens.map((target) => {
    const copy = pushText("wait_fee_started", target.locale);
    return {
      to: target.token,
      sound: resolvePushSound(data.type),
      title: copy.title,
      body: copy.body,
      data,
      priority: "high",
    };
  });

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

  const data = {
    type: "wait_final_warning",
    entity_type: params.entityType,
    entity_id: params.entityId,
  };

  const messages = tokens.map((target) => {
    const copy = pushText(
      params.entityKind === "taxi"
        ? "wait_final_warning_taxi"
        : "wait_final_warning_delivery",
      target.locale,
    );
    return {
      to: target.token,
      sound: resolvePushSound(data.type),
      title: copy.title,
      body: copy.body,
      data,
      priority: "high",
    };
  });

  await sendExpoPushMessages(messages);
}

export async function notifyClientTaxiRideAccepted(params: {
  supabaseAdmin: SupabaseClient;
  userIds: Array<string | null | undefined>;
  taxiRideId: string;
}): Promise<void> {
  const userIds = dedupeStrings(params.userIds);
  const tokens = await loadClientExpoTokens(params.supabaseAdmin, userIds);
  if (tokens.length === 0) return;

  const dedupKey = taxiRideAcceptedDedupKey(params.taxiRideId);
  if (await wasTaxiPushAlreadySent(params.supabaseAdmin, dedupKey)) {
    return;
  }

  const data = {
    type: "ride_accepted",
    taxi_ride_id: params.taxiRideId,
    taxiRideId: params.taxiRideId,
  };

  const messages = tokens.map((target) => {
    const copy = pushText("taxi_accepted", target.locale);
    return {
      to: target.token,
      sound: resolvePushSound(data.type),
      title: copy.title,
      body: copy.body,
      data,
      priority: "high",
    };
  });

  await sendExpoPushMessages(messages);
  await logTaxiClientPush({
    supabaseAdmin: params.supabaseAdmin,
    userId: userIds[0] ?? null,
    title: messages[0]?.title ?? "",
    body: messages[0]?.body ?? "",
    data,
    dedupKey,
    sent: true,
  });
}

export async function notifyClientTaxiDriverEnRoute(params: {
  supabaseAdmin: SupabaseClient;
  userIds: Array<string | null | undefined>;
  taxiRideId: string;
  etaMinutes: number;
}): Promise<void> {
  const etaMinutes = Number(params.etaMinutes);
  if (!Number.isFinite(etaMinutes) || etaMinutes <= 0) return;

  const userIds = dedupeStrings(params.userIds);
  const tokens = await loadClientExpoTokens(params.supabaseAdmin, userIds);
  if (tokens.length === 0) return;

  const roundedEta = Math.max(1, Math.round(etaMinutes));
  const dedupKey = taxiDriverEtaDedupKey(params.taxiRideId, roundedEta);
  if (await wasTaxiPushAlreadySent(params.supabaseAdmin, dedupKey)) {
    return;
  }

  const data = {
    type: "driver_en_route",
    taxi_ride_id: params.taxiRideId,
    taxiRideId: params.taxiRideId,
    eta_minutes: roundedEta,
  };

  const messages = tokens.map((target) => {
    const copy = pushText("taxi_en_route", target.locale, { minutes: roundedEta });
    return {
      to: target.token,
      sound: resolvePushSound(data.type),
      title: copy.title,
      body: copy.body,
      data,
      priority: "high",
    };
  });

  await sendExpoPushMessages(messages);
  await logTaxiClientPush({
    supabaseAdmin: params.supabaseAdmin,
    userId: userIds[0] ?? null,
    title: messages[0]?.title ?? "",
    body: messages[0]?.body ?? "",
    data,
    dedupKey,
    sent: true,
  });
}

export async function notifyClientTaxiRideCompleted(params: {
  supabaseAdmin: SupabaseClient;
  userIds: Array<string | null | undefined>;
  taxiRideId: string;
}): Promise<void> {
  const userIds = dedupeStrings(params.userIds);
  const tokens = await loadClientExpoTokens(params.supabaseAdmin, userIds);
  if (tokens.length === 0) return;

  const data = {
    type: "taxi_ride_completed",
    taxi_ride_id: params.taxiRideId,
    taxiRideId: params.taxiRideId,
  };

  const messages = tokens.map((target) => {
    const copy = pushText("taxi_completed", target.locale);
    return {
      to: target.token,
      sound: resolvePushSound("delivery_completed"),
      title: copy.title,
      body: copy.body,
      data,
      priority: "high",
    };
  });

  await sendExpoPushMessages(messages);
}

export async function notifyClientTaxiRideCancelled(params: {
  supabaseAdmin: SupabaseClient;
  userIds: Array<string | null | undefined>;
  taxiRideId: string;
  refund: "REQUIRED" | "NONE";
}): Promise<void> {
  const userIds = dedupeStrings(params.userIds);
  const tokens = await loadClientExpoTokens(params.supabaseAdmin, userIds);
  if (tokens.length === 0) return;

  const data = {
    type: "taxi_ride_cancelled",
    taxi_ride_id: params.taxiRideId,
    taxiRideId: params.taxiRideId,
    refund: params.refund,
  };

  const messages = tokens.map((target) => {
    const copy = pushText(
      params.refund === "REQUIRED" ? "taxi_cancelled_refund" : "taxi_cancelled",
      target.locale,
    );
    return {
      to: target.token,
      sound: resolvePushSound("order_cancelled"),
      title: copy.title,
      body: copy.body,
      data,
      priority: "high",
    };
  });

  await sendExpoPushMessages(messages);
}
