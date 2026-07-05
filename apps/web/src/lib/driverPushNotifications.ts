import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePushSound } from "./mmdPushSounds";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export type DriverVehicleNotificationKind =
  | "category_approved"
  | "category_rejected"
  | "category_suspended"
  | "category_reactivated"
  | "vehicle_expired_age"
  | "document_expired"
  | "document_validated"
  | "taxi_accept_rejected";

type PushTokenRow = {
  expo_push_token?: string | null;
  push_token?: string | null;
  token?: string | null;
  disabled?: boolean | null;
  is_active?: boolean | null;
};

function isExpoPushToken(value: unknown): value is string {
  const s = String(value ?? "").trim();
  return s.startsWith("ExponentPushToken[") || s.startsWith("ExpoPushToken[");
}

async function loadDriverExpoTokens(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data: tokenRows, error } = await supabaseAdmin
    .from("user_push_tokens")
    .select("*")
    .eq("user_id", userId);

  if (error) {
    console.log("[driverPush] token lookup failed:", error.message);
    return [];
  }

  return Array.from(
    new Set(
      ((tokenRows ?? []) as PushTokenRow[])
        .filter((row) => row.disabled !== true && row.is_active !== false)
        .map((row) => row.expo_push_token ?? row.push_token ?? row.token ?? null)
        .filter(isExpoPushToken),
    ),
  );
}

async function sendExpoPushMessages(messages: Array<Record<string, unknown>>): Promise<void> {
  if (messages.length === 0) return;

  const chunkSize = 100;
  for (let i = 0; i < messages.length; i += chunkSize) {
    const chunk = messages.slice(i, i + chunkSize);
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(chunk),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        console.log("[driverPush] expo push failed:", response.status, text);
      }
    } catch (e: unknown) {
      console.log("[driverPush] expo push error:", e instanceof Error ? e.message : String(e));
    }
  }
}

function categoryLabel(category: string): string {
  const map: Record<string, string> = {
    standard: "Standard",
    comfort: "Comfort",
    xl: "XL",
    wheelchair_accessible: "Wheelchair Accessible",
  };
  return map[category] ?? category;
}

function buildMessage(input: {
  kind: DriverVehicleNotificationKind;
  category?: string | null;
  documentType?: string | null;
  reason?: string | null;
}): { title: string; body: string } {
  const cat = categoryLabel(String(input.category ?? ""));

  switch (input.kind) {
    case "category_approved":
      return {
        title: "Catégorie approuvée",
        body: `Votre véhicule est maintenant admissible en ${cat}.`,
      };
    case "category_rejected":
      return {
        title: "Catégorie refusée",
        body: input.reason
          ? `Catégorie ${cat} refusée : ${input.reason}`
          : `Votre demande pour la catégorie ${cat} a été refusée.`,
      };
    case "category_suspended":
      return {
        title: "Catégorie suspendue",
        body: `La catégorie ${cat} a été suspendue pour votre véhicule.`,
      };
    case "category_reactivated":
      return {
        title: "Catégorie réactivée",
        body: `La catégorie ${cat} est de nouveau active pour votre véhicule.`,
      };
    case "vehicle_expired_age":
      return {
        title: "Véhicule trop ancien",
        body: input.reason
          ? input.reason
          : `Votre véhicule n'est plus admissible en ${cat} (limite d'âge dépassée).`,
      };
    case "document_expired":
      return {
        title: "Document expiré",
        body: `Votre document ${input.documentType ?? "véhicule"} a expiré. Mettez-le à jour pour conserver vos catégories taxi.`,
      };
    case "document_validated":
      return {
        title: "Document validé",
        body: `Votre document ${input.documentType ?? "véhicule"} a été validé par MMD.`,
      };
    case "taxi_accept_rejected":
      return {
        title: "Acceptation refusée",
        body: input.reason ?? "Vous ne pouvez plus accepter cette course.",
      };
    default:
      return { title: "MMD Delivery", body: "Mise à jour véhicule chauffeur." };
  }
}

export async function notifyDriverVehicleEvent(params: {
  supabaseAdmin: SupabaseClient;
  driverUserId: string;
  kind: DriverVehicleNotificationKind;
  category?: string | null;
  documentType?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<{ sent: number }> {
  const tokens = await loadDriverExpoTokens(params.supabaseAdmin, params.driverUserId);
  if (tokens.length === 0) return { sent: 0 };

  const { title, body } = buildMessage(params);
  const sound = resolvePushSound("driver_offer");

  const messages = tokens.map((token) => ({
    to: token,
    sound,
    title,
    body,
    priority: "high",
    channelId: "driver-alerts",
    data: {
      type: `driver_vehicle_${params.kind}`,
      category: params.category ?? null,
      ...(params.metadata ?? {}),
    },
  }));

  await sendExpoPushMessages(messages);

  await params.supabaseAdmin.from("driver_vehicle_notification_events").insert({
    driver_user_id: params.driverUserId,
    kind: params.kind,
    category: params.category ?? null,
    document_type: params.documentType ?? null,
    reason: params.reason ?? null,
    metadata: params.metadata ?? {},
  });

  return { sent: messages.length };
}

export async function notifyDriverEligibilityTransitions(params: {
  supabaseAdmin: SupabaseClient;
  driverUserId: string;
  before: Array<{ category: string; status: string }>;
  after: Array<{ category: string; status: string; reason_message?: string | null }>;
  adminAction?: "approve_category" | "reject_category" | "suspend_category" | "unsuspend_category" | null;
}): Promise<number> {
  let sent = 0;
  const beforeMap = new Map(params.before.map((row) => [row.category, row.status]));

  for (const row of params.after) {
    const prev = beforeMap.get(row.category);
    if (prev === row.status) continue;

    if (row.status === "eligible" && prev !== "eligible") {
      if (params.adminAction === "unsuspend_category") {
        const r = await notifyDriverVehicleEvent({
          supabaseAdmin: params.supabaseAdmin,
          driverUserId: params.driverUserId,
          kind: "category_reactivated",
          category: row.category,
        });
        sent += r.sent;
      } else {
        const r = await notifyDriverVehicleEvent({
          supabaseAdmin: params.supabaseAdmin,
          driverUserId: params.driverUserId,
          kind: "category_approved",
          category: row.category,
        });
        sent += r.sent;
      }
      continue;
    }

    if (row.status === "suspended") {
      const r = await notifyDriverVehicleEvent({
        supabaseAdmin: params.supabaseAdmin,
        driverUserId: params.driverUserId,
        kind: "category_suspended",
        category: row.category,
      });
      sent += r.sent;
      continue;
    }

    if (row.status === "expired_age") {
      const r = await notifyDriverVehicleEvent({
        supabaseAdmin: params.supabaseAdmin,
        driverUserId: params.driverUserId,
        kind: "vehicle_expired_age",
        category: row.category,
        reason: row.reason_message ?? undefined,
      });
      sent += r.sent;

      await params.supabaseAdmin
        .from("driver_service_preferences")
        .update({ taxi_rides_enabled: false, updated_at: new Date().toISOString() })
        .eq("driver_user_id", params.driverUserId)
        .eq("taxi_rides_enabled", true);
      continue;
    }

    if (
      row.status === "not_eligible" ||
      row.status === "missing_documents" ||
      row.status === "wheelchair_not_verified" ||
      row.status === "insufficient_seats"
    ) {
      if (prev === "eligible" || prev === "pending_review") {
        const r = await notifyDriverVehicleEvent({
          supabaseAdmin: params.supabaseAdmin,
          driverUserId: params.driverUserId,
          kind: "category_rejected",
          category: row.category,
          reason: row.reason_message ?? undefined,
        });
        sent += r.sent;
      }
    }
  }

  return sent;
}

export async function notifyDriverDocumentStatusChange(params: {
  supabaseAdmin: SupabaseClient;
  driverUserId: string;
  documentType: "inspection" | "insurance" | "registration";
  previousStatus: string;
  nextStatus: string;
}): Promise<number> {
  if (params.previousStatus === params.nextStatus) return 0;

  if (params.nextStatus === "expired") {
    const r = await notifyDriverVehicleEvent({
      supabaseAdmin: params.supabaseAdmin,
      driverUserId: params.driverUserId,
      kind: "document_expired",
      documentType: params.documentType,
    });
    return r.sent;
  }

  if (params.nextStatus === "approved" && params.previousStatus !== "approved") {
    const r = await notifyDriverVehicleEvent({
      supabaseAdmin: params.supabaseAdmin,
      driverUserId: params.driverUserId,
      kind: "document_validated",
      documentType: params.documentType,
    });
    return r.sent;
  }

  return 0;
}
