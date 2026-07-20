import type { SupabaseClient } from "@supabase/supabase-js";
import {
  maskExpoToken,
  sendExpoPushWithAudit,
  type ExpoReceiptRow,
  type ExpoTicketRow,
} from "@/lib/expoPushAudit";
import {
  DRIVER_MISSION_PUSH_CHANNEL,
  resolvePushSoundForPlatform,
} from "@/lib/mmdPushSounds";

export const DELIVERY_COMPLETED_CLIENT_EVENT = "delivery_request_delivered_client";
export const DELIVERY_COMPLETED_DRIVER_EVENT = "delivery_request_delivered_driver";

export type DeliveryCompletionNotifyResult = {
  client: { sent: number; skipped?: string; logs: number };
  driver: { sent: number; skipped?: string; logs: number };
};

function isExpoPushToken(value: unknown): value is string {
  const s = String(value ?? "").trim();
  return s.startsWith("ExponentPushToken[") || s.startsWith("ExpoPushToken[");
}

export function deliveryCompletionDedupKey(
  deliveryRequestId: string,
  eventType: string,
): string {
  return `${String(eventType).trim()}:${String(deliveryRequestId).trim()}`;
}

async function wasAlreadySent(
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
    console.log(
      "[deliveryCompletionNotify] dedup lookup failed:",
      error.message,
    );
    return false;
  }
  return (data ?? []).length > 0;
}

type TokenRow = {
  user_id: string;
  expo_push_token: string;
  platform?: string | null;
};

async function loadRoleTokens(
  supabaseAdmin: SupabaseClient,
  userIds: string[],
  role: "client" | "driver",
): Promise<TokenRow[]> {
  const ids = Array.from(
    new Set(userIds.map((x) => String(x ?? "").trim()).filter(Boolean)),
  );
  if (ids.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from("user_push_tokens")
    .select("user_id,expo_push_token,platform,role")
    .in("user_id", ids)
    .eq("role", role);

  if (error) {
    console.log(
      "[deliveryCompletionNotify] token lookup failed:",
      error.message,
    );
    return [];
  }

  const byToken = new Map<string, TokenRow>();
  for (const row of data ?? []) {
    const expo_push_token = String(row.expo_push_token ?? "").trim();
    const user_id = String(row.user_id ?? "").trim();
    if (!user_id || !isExpoPushToken(expo_push_token)) continue;
    byToken.set(expo_push_token, {
      user_id,
      expo_push_token,
      platform: row.platform ?? null,
    });
  }
  return [...byToken.values()];
}

async function insertLogs(
  supabaseAdmin: SupabaseClient,
  rows: Array<Record<string, unknown>>,
) {
  if (rows.length === 0) return;
  const { error } = await supabaseAdmin.from("notification_logs").insert(rows);
  if (error) {
    console.log(
      "[deliveryCompletionNotify] notification_logs insert failed:",
      error.message,
    );
  }
}

async function sendRoleCompletionPush(params: {
  supabaseAdmin: SupabaseClient;
  deliveryRequestId: string;
  eventType: string;
  role: "client" | "driver";
  userIds: string[];
  title: string;
  body: string;
  dataType: string;
}): Promise<{ sent: number; skipped?: string; logs: number }> {
  const dedupKey = deliveryCompletionDedupKey(
    params.deliveryRequestId,
    params.eventType,
  );

  if (await wasAlreadySent(params.supabaseAdmin, dedupKey)) {
    return { sent: 0, skipped: "dedup", logs: 0 };
  }

  const tokens = await loadRoleTokens(
    params.supabaseAdmin,
    params.userIds,
    params.role,
  );

  if (tokens.length === 0) {
    // Do not mark as sent — a later retry can succeed once tokens exist.
    await insertLogs(params.supabaseAdmin, [
      {
        user_id: params.userIds[0] ?? null,
        role: params.role,
        title: params.title,
        body: params.body,
        data: {
          type: params.dataType,
          event_type: params.eventType,
          delivery_request_id: params.deliveryRequestId,
          provider: "expo",
          expo_ticket_id: null,
          expo_receipt: null,
        },
        status: "failed",
        error_message: "no_tokens",
        dedup_key: `${dedupKey}:no_tokens`,
        sent_at: null,
      },
    ]);
    return { sent: 0, skipped: "no_tokens", logs: 1 };
  }

  const data = {
    type: params.dataType,
    delivery_request_id: params.deliveryRequestId,
    deliveryRequestId: params.deliveryRequestId,
    event_type: params.eventType,
  };

  const messages = tokens.map((tokenRow) => ({
    to: tokenRow.expo_push_token,
    sound: resolvePushSoundForPlatform(params.dataType, tokenRow.platform),
    title: params.title,
    body: params.body,
    data,
    priority: "high" as const,
    ...(params.role === "driver"
      ? { channelId: DRIVER_MISSION_PUSH_CHANNEL }
      : {}),
    _contentAvailable: true,
  }));

  const audit = await sendExpoPushWithAudit(messages, { receiptWaitMs: 1500 });
  const nowIso = new Date().toISOString();

  const logRows = tokens.map((tokenRow, i) => {
    const ticket: ExpoTicketRow | null = audit.tickets[i] ?? null;
    const ticketId = ticket?.id ? String(ticket.id) : null;
    const receipt: ExpoReceiptRow | null = ticketId
      ? audit.receipts[ticketId] ?? null
      : null;
    const ticketFailed = String(ticket?.status ?? "") === "error";
    const receiptFailed = String(receipt?.status ?? "") === "error";
    const status =
      !audit.ok || ticketFailed || receiptFailed ? "failed" : "sent";

    return {
      user_id: tokenRow.user_id,
      role: params.role,
      title: params.title,
      body: params.body,
      data: {
        ...data,
        provider: "expo",
        expo_token_masked: maskExpoToken(tokenRow.expo_push_token),
        expo_ticket_id: ticketId,
        expo_ticket_status: ticket?.status ?? null,
        expo_ticket: ticket,
        expo_receipt: receipt,
        expo_receipt_status: receipt?.status ?? null,
        platform: tokenRow.platform ?? null,
      },
      status,
      error_message:
        ticket?.message ||
        receipt?.message ||
        audit.error ||
        (status === "failed" ? "push_failed" : null),
      // Canonical event dedup key on every row for this delivery_request_id + event_type.
      dedup_key: dedupKey,
      sent_at: status === "sent" ? nowIso : null,
    };
  });

  await insertLogs(params.supabaseAdmin, logRows);

  const sent = logRows.filter((r) => r.status === "sent").length;
  return {
    sent,
    logs: logRows.length,
    skipped: sent === 0 ? "send_failed" : undefined,
  };
}

/**
 * Notify client + driver that a Delivery Request is delivered.
 * Idempotent via notification_logs.dedup_key = event_type:delivery_request_id (status=sent).
 * Does not touch finance, loyalty, or commissions.
 */
export async function notifyDeliveryRequestCompleted(params: {
  supabaseAdmin: SupabaseClient;
  deliveryRequestId: string;
  clientUserIds: Array<string | null | undefined>;
  driverUserId: string | null | undefined;
}): Promise<DeliveryCompletionNotifyResult> {
  const deliveryRequestId = String(params.deliveryRequestId ?? "").trim();
  const clientIds = Array.from(
    new Set(
      params.clientUserIds.map((x) => String(x ?? "").trim()).filter(Boolean),
    ),
  );
  const driverId = String(params.driverUserId ?? "").trim() || null;

  const client = await sendRoleCompletionPush({
    supabaseAdmin: params.supabaseAdmin,
    deliveryRequestId,
    eventType: DELIVERY_COMPLETED_CLIENT_EVENT,
    role: "client",
    userIds: clientIds,
    title: "Livraison terminée",
    body: "Votre colis a été livré. Merci d’avoir choisi MMD Delivery.",
    dataType: "delivery_completed",
  });

  const driver = driverId
    ? await sendRoleCompletionPush({
        supabaseAdmin: params.supabaseAdmin,
        deliveryRequestId,
        eventType: DELIVERY_COMPLETED_DRIVER_EVENT,
        role: "driver",
        userIds: [driverId],
        title: "Mission terminée",
        body: "Livraison confirmée. Merci pour votre course.",
        dataType: "delivery_completed",
      })
    : { sent: 0, skipped: "no_driver", logs: 0 };

  return { client, driver };
}
