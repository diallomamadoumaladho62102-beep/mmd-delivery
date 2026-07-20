import { AppState, Platform, Vibration, type AppStateStatus } from "react-native";
import * as Notifications from "expo-notifications";
import { mmdAudio } from "./mmdAudio";
import { isDriverMissionPushType } from "./driverMissionPush";
import { DRIVER_MISSION_PUSH_CHANNEL } from "./mmdPushSounds";
import { supabase } from "./supabase";
import {
  subscribePostgresChannel,
  unsubscribeSupabaseChannel,
} from "./supabaseRealtime";

/**
 * Global driver mission long-ring — independent of DriverHomeScreen / isFocused.
 * Starts on push OR Realtime offer insert (delivery + taxi); stops only via
 * stopDriverMissionAlert (accept / decline / expire).
 */

let ringing = false;
let activeKey: string | null = null;
let activeDriverUserId: string | null = null;
let channel: ReturnType<typeof subscribePostgresChannel> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;
let iosVibrateTimer: ReturnType<typeof setInterval> | null = null;
const announcedKeys = new Set<string>();

function missionKey(type: string, id: string | null): string {
  return `${type}:${id ?? "unknown"}`;
}

function startMissionVibration() {
  try {
    if (Platform.OS === "android") {
      Vibration.vibrate([0, 700, 250, 700, 250, 700], true);
      return;
    }
    Vibration.vibrate([0, 500, 200, 500, 200, 500]);
    if (iosVibrateTimer) clearInterval(iosVibrateTimer);
    iosVibrateTimer = setInterval(() => {
      Vibration.vibrate([0, 500, 200, 500]);
    }, 1800);
  } catch {
    /* vibration unavailable */
  }
}

function stopMissionVibration() {
  try {
    Vibration.cancel();
  } catch {
    /* ignore */
  }
  if (iosVibrateTimer) {
    clearInterval(iosVibrateTimer);
    iosVibrateTimer = null;
  }
}

async function setRinging(shouldRing: boolean, key?: string | null) {
  if (shouldRing) {
    if (ringing && (!key || activeKey === key)) return;
    ringing = true;
    if (key) activeKey = key;
    startMissionVibration();
    try {
      await mmdAudio.startLongRing("driver");
    } catch (error) {
      console.log("[driverMissionAlert] startLongRing failed", error);
      ringing = false;
      activeKey = null;
      stopMissionVibration();
    }
    return;
  }
  stopMissionVibration();
  if (!ringing && !activeKey) {
    try {
      await mmdAudio.stopLongRing();
    } catch {
      /* ignore */
    }
    return;
  }
  ringing = false;
  activeKey = null;
  try {
    await mmdAudio.stopLongRing();
  } catch {
    /* ignore */
  }
}

async function showLocalMissionNotification(params: {
  title: string;
  body: string;
  data: Record<string, unknown>;
}) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: params.title,
        body: params.body,
        sound: true,
        data: { ...params.data, local_alert: true },
        ...(Platform.OS === "android"
          ? { channelId: DRIVER_MISSION_PUSH_CHANNEL }
          : {}),
      },
      trigger: null,
    });
  } catch (error) {
    console.log("[driverMissionAlert] local notification failed", error);
  }
}

export async function startDriverMissionAlert(params: {
  type: string;
  orderId?: string | null;
  deliveryRequestId?: string | null;
  taxiRideId?: string | null;
  playLocalNotification?: boolean;
}): Promise<void> {
  if (!isDriverMissionPushType(params.type)) return;

  const id =
    params.deliveryRequestId ?? params.orderId ?? params.taxiRideId ?? null;
  const key = missionKey(params.type, id);
  announcedKeys.add(key);

  const isTaxi = params.type === "taxi_offer_dispatch";

  if (params.playLocalNotification !== false) {
    await showLocalMissionNotification({
      title: isTaxi ? "Nouvelle course taxi" : "Nouvelle mission disponible",
      body: isTaxi
        ? "Une course taxi proche est disponible."
        : "Une livraison proche est disponible.",
      data: {
        type: params.type,
        deliveryRequestId: params.deliveryRequestId ?? null,
        orderId: params.orderId ?? null,
        taxiRideId: params.taxiRideId ?? null,
      },
    });
  }

  // Foreground: always ring + vibrate. Background: OS push channel covers sound.
  if (AppState.currentState === "active") {
    await setRinging(true, key);
  }
}

export async function stopDriverMissionAlert(): Promise<void> {
  await setRinging(false);
}

export function handleDriverMissionPushAlert(data: unknown): void {
  const record = (data ?? {}) as Record<string, unknown>;
  const type = String(record.type ?? "").trim();
  if (!isDriverMissionPushType(type)) return;

  void startDriverMissionAlert({
    type,
    orderId: String(record.orderId ?? record.order_id ?? "").trim() || null,
    deliveryRequestId:
      String(record.deliveryRequestId ?? record.delivery_request_id ?? "").trim() ||
      null,
    taxiRideId:
      String(record.taxiRideId ?? record.taxi_ride_id ?? "").trim() || null,
    // Remote push already notified OS in background/locked; avoid duplicate local.
    playLocalNotification: AppState.currentState === "active",
  });
}

export function isDriverMissionAlertRinging(): boolean {
  return ringing;
}

async function fetchPendingDeliveryOffers(driverUserId: string) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("delivery_request_driver_offers")
    .select("id,delivery_request_id,status,expires_at")
    .eq("driver_id", driverUserId)
    .eq("status", "pending")
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.log("[driverMissionAlert] delivery offers fetch failed", error.message);
    return;
  }

  for (const row of data ?? []) {
    const drId = String(
      (row as { delivery_request_id?: string }).delivery_request_id ?? "",
    ).trim();
    if (!drId) continue;
    const key = missionKey("delivery_request_dispatch", drId);
    if (announcedKeys.has(key)) continue;
    await startDriverMissionAlert({
      type: "delivery_request_dispatch",
      deliveryRequestId: drId,
      playLocalNotification: true,
    });
  }
}

async function fetchPendingTaxiOffers(driverUserId: string) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("taxi_offers")
    .select("id,taxi_ride_id,status,expires_at")
    .eq("driver_id", driverUserId)
    .eq("status", "pending")
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.log("[driverMissionAlert] taxi offers fetch failed", error.message);
    return;
  }

  for (const row of data ?? []) {
    const rideId = String(
      (row as { taxi_ride_id?: string }).taxi_ride_id ?? "",
    ).trim();
    if (!rideId) continue;
    const key = missionKey("taxi_offer_dispatch", rideId);
    if (announcedKeys.has(key)) continue;
    await startDriverMissionAlert({
      type: "taxi_offer_dispatch",
      taxiRideId: rideId,
      playLocalNotification: true,
    });
  }
}

async function fetchPendingMissionOffers(driverUserId: string) {
  await fetchPendingDeliveryOffers(driverUserId);
  await fetchPendingTaxiOffers(driverUserId);
}

function onAppStateChange(state: AppStateStatus) {
  if (state === "active") {
    if (activeDriverUserId) {
      void fetchPendingMissionOffers(activeDriverUserId);
    }
    if (activeKey) {
      void setRinging(true, activeKey);
    }
    return;
  }
  // Background / locked: stop in-app loop; OS push channel covers sound.
  void setRinging(false);
}

export async function startDriverMissionAlertService(
  driverUserId: string,
): Promise<void> {
  const uid = String(driverUserId ?? "").trim();
  if (!uid) return;

  if (activeDriverUserId === uid && channel) {
    void fetchPendingMissionOffers(uid);
    return;
  }

  await stopDriverMissionAlertService({ keepAnnounced: true });
  activeDriverUserId = uid;
  await mmdAudio.init();

  channel = subscribePostgresChannel(`driver-mission-alert-${uid}`, [
    {
      event: "*",
      table: "delivery_request_driver_offers",
      filter: `driver_id=eq.${uid}`,
      callback: () => {
        void fetchPendingDeliveryOffers(uid);
      },
    },
    {
      event: "*",
      table: "taxi_offers",
      filter: `driver_id=eq.${uid}`,
      callback: () => {
        void fetchPendingTaxiOffers(uid);
      },
    },
  ]);

  pollTimer = setInterval(() => {
    void fetchPendingMissionOffers(uid);
  }, 8000);

  appStateSub = AppState.addEventListener("change", onAppStateChange);
  await fetchPendingMissionOffers(uid);
}

export async function stopDriverMissionAlertService(opts?: {
  keepAnnounced?: boolean;
}): Promise<void> {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (appStateSub) {
    appStateSub.remove();
    appStateSub = null;
  }
  if (channel) {
    await unsubscribeSupabaseChannel(channel);
    channel = null;
  }
  activeDriverUserId = null;
  await setRinging(false);
  if (!opts?.keepAnnounced) {
    announcedKeys.clear();
  }
}
