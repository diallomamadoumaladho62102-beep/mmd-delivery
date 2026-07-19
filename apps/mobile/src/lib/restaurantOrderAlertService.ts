import { AppState, Platform, type AppStateStatus } from "react-native";
import * as Notifications from "expo-notifications";
import { supabase } from "./supabase";
import {
  subscribePostgresChannel,
  unsubscribeSupabaseChannel,
} from "./supabaseRealtime";
import { mmdAudio } from "./mmdAudio";
import {
  planRestaurantOrderAlert,
  type RestaurantAlertOrder,
} from "./restaurantOrderAlertLogic";
import { RESTAURANT_ORDERS_PUSH_CHANNEL } from "./mmdPushSounds";

type BannerPayload = {
  orderId: string;
  title: string;
  body: string;
};

type BannerListener = (banner: BannerPayload | null) => void;

const bannerListeners = new Set<BannerListener>();
const announcedOrderIds = new Set<string>();
/** Keep ringing briefly after push even if auto-accept clears pending status. */
const forcedRingUntilByOrderId = new Map<string, number>();
const FORCE_RING_MS = 90_000;

let activeRestaurantUserId: string | null = null;
let channel: ReturnType<typeof subscribePostgresChannel> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;
let ringing = false;
let latestBanner: BannerPayload | null = null;
let fetchInFlight = false;

function pruneForcedRings(nowMs = Date.now()) {
  for (const [orderId, until] of forcedRingUntilByOrderId) {
    if (until <= nowMs) forcedRingUntilByOrderId.delete(orderId);
  }
}

function hasForcedRing(nowMs = Date.now()): boolean {
  pruneForcedRings(nowMs);
  return forcedRingUntilByOrderId.size > 0;
}

function forceRingForOrder(orderId: string, nowMs = Date.now()) {
  forcedRingUntilByOrderId.set(orderId, nowMs + FORCE_RING_MS);
}

export function subscribeRestaurantOrderBanner(listener: BannerListener) {
  bannerListeners.add(listener);
  if (latestBanner) listener(latestBanner);
  return () => {
    bannerListeners.delete(listener);
  };
}

function emitBanner(banner: BannerPayload | null) {
  latestBanner = banner;
  bannerListeners.forEach((listener) => {
    try {
      listener(banner);
    } catch (error) {
      console.log("[restaurantOrderAlert] banner listener error", error);
    }
  });
}

async function setRinging(shouldRing: boolean) {
  if (shouldRing) {
    if (ringing) return;
    ringing = true;
    try {
      await mmdAudio.startLongRing("restaurant");
    } catch (error) {
      console.log("[restaurantOrderAlert] startLongRing failed", error);
      ringing = false;
    }
    return;
  }
  if (!ringing) return;
  ringing = false;
  try {
    await mmdAudio.stopLongRing();
  } catch {
    /* ignore */
  }
}

async function showLocalBanner(orderId: string) {
  const banner: BannerPayload = {
    orderId,
    title: "Nouvelle commande",
    body: "Une commande payée vient d'arriver.",
  };
  emitBanner(banner);

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: banner.title,
        body: banner.body,
        sound: true,
        data: {
          type: "restaurant_new_order",
          order_id: orderId,
          local_alert: true,
        },
        ...(Platform.OS === "android"
          ? { channelId: RESTAURANT_ORDERS_PUSH_CHANNEL }
          : {}),
      },
      trigger: null,
    });
  } catch (error) {
    console.log("[restaurantOrderAlert] local notification failed", error);
  }
}

async function applyOrders(orders: RestaurantAlertOrder[]) {
  const plan = planRestaurantOrderAlert({
    orders,
    announcedOrderIds,
  });

  for (const orderId of plan.newlyAnnouncedIds) {
    announcedOrderIds.add(orderId);
    forceRingForOrder(orderId);
    await showLocalBanner(orderId);
  }

  const appActive = AppState.currentState === "active";
  const shouldRing = plan.shouldRing || hasForcedRing();
  await setRinging(appActive && shouldRing);

  if (!shouldRing) {
    emitBanner(null);
  }
}

async function fetchAndApply() {
  if (!activeRestaurantUserId || fetchInFlight) return;
  fetchInFlight = true;
  try {
    const { data, error } = await supabase
      .from("orders")
      .select(
        "id,kind,status,payment_status,created_at,restaurant_accept_expires_at",
      )
      .eq("kind", "food")
      .eq("payment_status", "paid")
      .or(
        `restaurant_user_id.eq.${activeRestaurantUserId},restaurant_id.eq.${activeRestaurantUserId}`,
      )
      .order("created_at", { ascending: false })
      .limit(40);

    if (error) {
      console.log("[restaurantOrderAlert] fetch failed", error.message);
      return;
    }

    await applyOrders((data ?? []) as RestaurantAlertOrder[]);
  } finally {
    fetchInFlight = false;
  }
}

function onAppStateChange(state: AppStateStatus) {
  if (state === "active") {
    void fetchAndApply();
    return;
  }
  // Background/inactive: stop local long-ring; OS push covers sound.
  void setRinging(false);
}

/**
 * Start global restaurant order detection (Realtime + poll).
 * Safe to call repeatedly for the same restaurant user id.
 */
export async function startRestaurantOrderAlertService(
  restaurantUserId: string,
): Promise<void> {
  const uid = String(restaurantUserId ?? "").trim();
  if (!uid) return;

  if (activeRestaurantUserId === uid && channel) {
    void fetchAndApply();
    return;
  }

  await stopRestaurantOrderAlertService({ keepAnnounced: true });

  activeRestaurantUserId = uid;
  await mmdAudio.init();

  channel = subscribePostgresChannel(`restaurant-alert-global-${uid}`, [
    {
      event: "*",
      table: "orders",
      filter: `restaurant_user_id=eq.${uid}`,
      callback: () => {
        void fetchAndApply();
      },
    },
    {
      event: "*",
      table: "orders",
      filter: `restaurant_id=eq.${uid}`,
      callback: () => {
        void fetchAndApply();
      },
    },
  ]);

  pollTimer = setInterval(() => {
    void fetchAndApply();
  }, 15000);

  appStateSub = AppState.addEventListener("change", onAppStateChange);
  await fetchAndApply();
}

export async function stopRestaurantOrderAlertService(opts?: {
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
  activeRestaurantUserId = null;
  await setRinging(false);
  emitBanner(null);
  if (!opts?.keepAnnounced) {
    announcedOrderIds.clear();
    forcedRingUntilByOrderId.clear();
  }
}

/**
 * Called when a restaurant_new_order push is received while app is open.
 * Idempotent by order_id for the current session.
 */
export async function handleRestaurantNewOrderPush(orderId: string): Promise<void> {
  const id = String(orderId ?? "").trim();
  if (!id) return;

  forceRingForOrder(id);

  if (!announcedOrderIds.has(id)) {
    announcedOrderIds.add(id);
    await showLocalBanner(id);
  }

  if (AppState.currentState === "active") {
    await setRinging(true);
  }

  // Refresh state, but forcedRingUntil keeps the alarm alive if auto-accept
  // already moved the order out of pending.
  void fetchAndApply();
}

/** Test helpers */
export function __restaurantAlertTestReset() {
  announcedOrderIds.clear();
  forcedRingUntilByOrderId.clear();
  ringing = false;
  latestBanner = null;
}

export function __restaurantAlertTestAnnouncedIds() {
  return [...announcedOrderIds];
}
