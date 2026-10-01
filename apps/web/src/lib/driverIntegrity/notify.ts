import type { SupabaseClient } from "@supabase/supabase-js";
import { pushText } from "@/lib/pushCopy";
import { resolvePushSound } from "@/lib/mmdPushSounds";
import { normalizeAppLocale, type AppLocale } from "@/lib/userLocale";
import type { DriverIntegrityWarningKind } from "./types";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

type PushTarget = { token: string; locale: AppLocale };

function isExpoPushToken(value: unknown): value is string {
  const s = String(value ?? "").trim();
  return s.startsWith("ExponentPushToken[") || s.startsWith("ExpoPushToken[");
}

async function loadDriverExpoTokens(
  supabaseAdmin: SupabaseClient,
  userId: string
): Promise<PushTarget[]> {
  const { data: tokenRows, error } = await supabaseAdmin
    .from("user_push_tokens")
    .select("*")
    .eq("user_id", userId);
  if (error) return [];
  const seen = new Set<string>();
  const out: PushTarget[] = [];
  for (const row of (tokenRows ?? []) as Array<Record<string, unknown>>) {
    if (row.disabled === true || row.is_active === false) continue;
    const token = row.expo_push_token ?? row.push_token ?? row.token ?? null;
    if (!isExpoPushToken(token) || seen.has(token)) continue;
    seen.add(token);
    out.push({ token, locale: normalizeAppLocale(row.locale) });
  }
  return out;
}

function warningCopyKey(kind: DriverIntegrityWarningKind): "driver_integrity_warning" | "driver_integrity_final_warning" {
  return kind === "final"
    ? "driver_integrity_final_warning"
    : "driver_integrity_warning";
}

export async function notifyDriverIntegrityWarning(params: {
  supabaseAdmin: SupabaseClient;
  driverUserId: string;
  incidentId: string;
  entityType: string;
  entityId: string;
  kind: DriverIntegrityWarningKind;
}): Promise<{ sent: number; duplicate: boolean }> {
  const dedupKey = `driver_integrity_warning:${params.incidentId}:${params.kind}`;
  const { data: existing } = await params.supabaseAdmin
    .from("notification_logs")
    .select("id")
    .eq("dedup_key", dedupKey)
    .eq("status", "sent")
    .maybeSingle();
  if (existing?.id) return { sent: 0, duplicate: true };

  const tokens = await loadDriverExpoTokens(
    params.supabaseAdmin,
    params.driverUserId
  );
  const sound = resolvePushSound("driver_offer");
  const messages = tokens.map((target) => {
    const copy = pushText(warningCopyKey(params.kind), target.locale);
    return {
      to: target.token,
      sound,
      title: copy.title,
      body: copy.body,
      priority: "high",
      channelId: "driver-alerts",
      data: {
        type: "driver_integrity_warning",
        kind: params.kind,
        incident_id: params.incidentId,
        entity_type: params.entityType,
        entity_id: params.entityId,
      },
    };
  });

  if (messages.length > 0) {
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
    } catch (e: unknown) {
      console.log(
        "[driverIntegrity] push error:",
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  const copy = pushText(warningCopyKey(params.kind), "en");
  const { error } = await params.supabaseAdmin.from("notification_logs").insert({
    user_id: params.driverUserId,
    role: "driver",
    title: copy.title,
    body: copy.body,
    data: {
      type: "driver_integrity_warning",
      kind: params.kind,
      incident_id: params.incidentId,
    },
    status: "sent",
    dedup_key: dedupKey,
    sent_at: new Date().toISOString(),
  });
  if (error && /duplicate|unique|23505/i.test(error.message)) {
    return { sent: 0, duplicate: true };
  }
  return { sent: messages.length, duplicate: false };
}
