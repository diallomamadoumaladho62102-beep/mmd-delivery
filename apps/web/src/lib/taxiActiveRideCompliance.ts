import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePushSound } from "./mmdPushSounds";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

type ComplianceEventRow = {
  id: string;
  taxi_ride_id: string;
  driver_user_id: string;
  event_type: string;
  notify_driver: boolean;
  notify_client: boolean;
  message_driver: string | null;
  message_client: string | null;
  driver_notified_at: string | null;
  client_notified_at: string | null;
};

function isExpoPushToken(value: unknown): value is string {
  const s = String(value ?? "").trim();
  return s.startsWith("ExponentPushToken[") || s.startsWith("ExpoPushToken[");
}

async function loadUserExpoTokens(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data: tokenRows, error } = await supabaseAdmin
    .from("user_push_tokens")
    .select("*")
    .eq("user_id", userId);

  if (error) return [];

  return Array.from(
    new Set(
      (tokenRows ?? [])
        .filter(
          (row: Record<string, unknown>) =>
            row.disabled !== true && row.is_active !== false,
        )
        .map(
          (row: Record<string, unknown>) =>
            row.expo_push_token ?? row.push_token ?? row.token ?? null,
        )
        .filter(isExpoPushToken),
    ),
  );
}

async function sendExpoPush(messages: Array<Record<string, unknown>>): Promise<void> {
  if (messages.length === 0) return;

  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(chunk),
      });
    } catch (e: unknown) {
      console.log(
        "[taxi compliance] push error:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }
}

export async function runActiveTaxiRideComplianceScan(
  supabaseAdmin: SupabaseClient,
): Promise<{
  scanned: number;
  eventsInserted: number;
  driverNotifications: number;
  clientNotifications: number;
}> {
  const { data: scanResult, error: scanError } = await supabaseAdmin.rpc(
    "scan_active_taxi_ride_compliance",
  );

  if (scanError) {
    throw new Error(scanError.message);
  }

  const payload = (scanResult ?? {}) as {
    scanned?: number;
    events_inserted?: number;
  };

  const { data: pendingEvents, error: pendingError } = await supabaseAdmin
    .from("taxi_ride_compliance_events")
    .select(
      "id,taxi_ride_id,driver_user_id,event_type,notify_driver,notify_client,message_driver,message_client,driver_notified_at,client_notified_at",
    )
    .or("driver_notified_at.is.null,client_notified_at.is.null")
    .limit(200);

  if (pendingError) {
    throw new Error(pendingError.message);
  }

  let driverNotifications = 0;
  let clientNotifications = 0;
  const nowIso = new Date().toISOString();

  for (const event of (pendingEvents ?? []) as ComplianceEventRow[]) {
    if (event.notify_driver && !event.driver_notified_at && event.message_driver) {
      const tokens = await loadUserExpoTokens(supabaseAdmin, event.driver_user_id);
      if (tokens.length > 0) {
        await sendExpoPush(
          tokens.map((token) => ({
            to: token,
            sound: resolvePushSound("order_cancelled"),
            title: "Action requise — Taxi MMD",
            body: event.message_driver,
            data: {
              type: "taxi_compliance_driver",
              taxi_ride_id: event.taxi_ride_id,
              event_type: event.event_type,
            },
          })),
        );
        driverNotifications += 1;
      }

      await supabaseAdmin
        .from("taxi_ride_compliance_events")
        .update({ driver_notified_at: nowIso })
        .eq("id", event.id);
    }

    if (event.notify_client && !event.client_notified_at && event.message_client) {
      const { data: ride } = await supabaseAdmin
        .from("taxi_rides")
        .select("client_user_id")
        .eq("id", event.taxi_ride_id)
        .maybeSingle();

      const clientUserId = ride?.client_user_id ? String(ride.client_user_id) : "";
      if (clientUserId) {
        const tokens = await loadUserExpoTokens(supabaseAdmin, clientUserId);
        if (tokens.length > 0) {
          await sendExpoPush(
            tokens.map((token) => ({
              to: token,
              sound: resolvePushSound("client_update"),
              title: "Information course MMD",
              body: event.message_client,
              data: {
                type: "taxi_compliance_client",
                taxi_ride_id: event.taxi_ride_id,
                event_type: event.event_type,
              },
            })),
          );
          clientNotifications += 1;
        }
      }

      await supabaseAdmin
        .from("taxi_ride_compliance_events")
        .update({ client_notified_at: nowIso })
        .eq("id", event.id);
    }
  }

  return {
    scanned: Number(payload.scanned ?? 0),
    eventsInserted: Number(payload.events_inserted ?? 0),
    driverNotifications,
    clientNotifications,
  };
}
