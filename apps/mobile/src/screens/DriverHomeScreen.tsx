import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from "react";
import {
  View,
  Text,
  StatusBar,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Platform,
  Animated,
  PanResponder,
  AppState,
  StyleSheet,
  Vibration,
  Dimensions,
  type AppStateStatus,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MapFloatingButton } from "../components/driver/map/MapFloatingButton";
import { DriverHomePremiumSheet } from "../components/driver/home/DriverHomePremiumSheet";
import {
  DriverHomeServiceModes,
  type DriverServiceModeKey,
} from "../components/driver/home/DriverHomeServiceModes";
import { MmdDriverLocationMarker } from "../components/driver/home/MmdDriverLocationMarker";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";
import { applyLiveTripFilters } from "../lib/tripVisibility";
import {
  subscribePostgresChannel,
  unsubscribeSupabaseChannel,
} from "../lib/supabaseRealtime";
import { notifyTaxiOfferPushReceived } from "../lib/taxiPushEvents";
import {
  getDriverOnlineStatus,
  setDriverOnlineStatus,
} from "../lib/driverStatus";
import { registerUserPushToken } from "../lib/notifications";
import {
  driverOnlineBlockMessage,
  isDriverOnlineEligible,
} from "../lib/accountStatus";
import { useDriverPlatformFeatures } from "../hooks/useDriverPlatformFeatures";
import MarketScopePill from "../components/market/MarketScopePill";
import { resolveMarketScopeFromFeatures } from "../lib/marketScope";
import { ensureMapboxTokenApplied } from "../lib/mapboxConfig";
import {
  fetchDriverServicePreferences,
  hasAnyDriverServiceEnabled,
  setDriverOnlineViaApi,
  type DriverServicePreferences,
} from "../lib/driverServicePreferencesApi";
import {
  fetchDriverAreaIntelligence,
  fetchDriverNextReward,
  type DriverAreaIntelligence,
  type DriverMarketingNextReward,
} from "../lib/driverAreaIntelligenceApi";
import { fetchActiveTaxiRide, formatDriverPayout } from "../lib/taxiDriverApi";
import {
  fetchDriverIdentityStatus,
  identityBlocksDriverOnline,
} from "../lib/driverIdentityApi";
import { getStableDriverDeviceId } from "../lib/driverDeviceId";
import {
  startDriverLocationTracking,
  stopDriverLocationTracking,
} from "../lib/location";
import {
  DRIVER_ONLINE_GRACE_MS,
  DRIVER_PRESENCE_HEARTBEAT_MS,
} from "../lib/driverPresenceConfig";
import { subscribeDriverMissionPushRefresh } from "../lib/driverMissionPushEvents";
import { toUserFacingError } from "../lib/userFacingError";

import Mapbox from "@rnmapbox/maps";
import * as Location from "expo-location";
import { mmdAudio } from "../lib/mmdAudio";
import { useTranslation } from "react-i18next";
import { useDriverKeepAwake } from "../hooks/useDriverKeepAwake";
import { DriverTaxiPanel } from "../components/driver/DriverTaxiPanel";
import {
  acceptDriverMarketplaceJob,
  fetchDriverMarketplaceJobs,
  mapMarketplaceJobToDriverOrder,
} from "../lib/driverMarketplaceApi";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type AnyNav = NativeStackNavigationProp<any>;

type OrderStatus =
  | "pending"
  | "paid_pending"
  | "processing_pending"
  | "accepted"
  | "prepared"
  | "ready"
  | "dispatched"
  | "delivered"
  | "canceled";

type OrderKind = "pickup_dropoff" | "food" | string;

type DriverOrder = {
  id: string;
  kind: OrderKind;
  status: OrderStatus;
  created_at: string | null;
  restaurant_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_miles: number | null;
  delivery_fee: number | null;
  driver_delivery_payout: number | null;
  total: number | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  source_table?: "orders" | "delivery_requests" | "marketplace_delivery_jobs";
  offer_id?: string | null;
  offer_expires_at?: string | null;
  is_dispatch_offer?: boolean;
  marketplace_job_status?: string | null;
};

type ZoneDemand = "calm" | "busy" | "very_busy";

type ZoneDef = {
  name: string;
  demand: ZoneDemand;
  multiplier: number;
  zoomDelta: number;
  bounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
};

const ZONES: ZoneDef[] = [
  {
    name: "East New York",
    demand: "busy",
    multiplier: 1.3,
    zoomDelta: 0.035,
    bounds: { minLat: 40.65, maxLat: 40.69, minLon: -73.9, maxLon: -73.84 },
  },
  {
    name: "Flatbush",
    demand: "busy",
    multiplier: 1.4,
    zoomDelta: 0.035,
    bounds: { minLat: 40.63, maxLat: 40.66, minLon: -73.97, maxLon: -73.94 },
  },
  {
    name: "Downtown Brooklyn",
    demand: "very_busy",
    multiplier: 1.6,
    zoomDelta: 0.03,
    bounds: { minLat: 40.68, maxLat: 40.7, minLon: -73.99, maxLon: -73.97 },
  },
  {
    name: "Manhattan",
    demand: "very_busy",
    multiplier: 1.8,
    zoomDelta: 0.04,
    bounds: { minLat: 40.7, maxLat: 40.86, minLon: -74.02, maxLon: -73.93 },
  },
  {
    name: "Queens",
    demand: "busy",
    multiplier: 1.2,
    zoomDelta: 0.06,
    bounds: { minLat: 40.68, maxLat: 40.78, minLon: -73.92, maxLon: -73.77 },
  },
  {
    name: "Bronx",
    demand: "busy",
    multiplier: 1.1,
    zoomDelta: 0.06,
    bounds: { minLat: 40.81, maxLat: 40.92, minLon: -73.93, maxLon: -73.82 },
  },
  {
    name: "Staten Island",
    demand: "calm",
    multiplier: 1.0,
    zoomDelta: 0.07,
    bounds: { minLat: 40.48, maxLat: 40.64, minLon: -74.26, maxLon: -74.05 },
  },
];


type DriverPerformanceStats = {
  todayEarnings: number;
  lifetimeEarnings: number;
  completedTripsToday: number;
  completedTripsTotal: number;
  points: number;
  level: string;
  nextLevel: string | null;
  levelProgress: number;
  dailyEarningsGoal: number;
  earningsGoalProgress: number;
};

const DRIVER_LEVELS = [
  { name: "Bronze", minPoints: 0 },
  { name: "Silver", minPoints: 1000 },
  { name: "Gold", minPoints: 5000 },
  { name: "Platinum", minPoints: 10000 },
];

const DEFAULT_DAILY_EARNINGS_GOAL = 150;

function getTodayStartIso() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

function getRecordNumber(record: any, keys: string[]) {
  for (const key of keys) {
    const value = toFiniteNumber(record?.[key]);
    if (value != null) return value;
  }
  return null;
}

function getCompletionDateIso(record: any) {
  return (
    record?.delivered_at ??
    record?.completed_at ??
    record?.dropoff_code_verified_at ??
    record?.updated_at ??
    record?.created_at ??
    null
  );
}

function normalizeDriverLevelName(value: unknown) {
  const clean = String(value ?? "").trim().toLowerCase();
  const found = DRIVER_LEVELS.find((level) => level.name.toLowerCase() === clean);
  return found?.name ?? null;
}

function getDriverLevelFromPoints(points: number) {
  let current = DRIVER_LEVELS[0];
  for (const level of DRIVER_LEVELS) {
    if (points >= level.minPoints) current = level;
  }
  return current;
}

function getNextDriverLevel(points: number) {
  return DRIVER_LEVELS.find((level) => level.minPoints > points) ?? null;
}

function buildDriverPerformanceStats(params: {
  rewardAccount: any | null;
  todayDeliveredRows: any[];
  profile?: any | null;
}) {
  const { rewardAccount, todayDeliveredRows, profile } = params;

  const accountPoints = getRecordNumber(rewardAccount, ["points"]) ?? 0;
  const lifetimePoints =
    getRecordNumber(rewardAccount, ["lifetime_points"]) ?? accountPoints;

  const completedTripsTotal =
    getRecordNumber(rewardAccount, ["completed_deliveries"]) ?? 0;

  const lifetimeEarnings =
    getRecordNumber(rewardAccount, ["total_earnings"]) ?? 0;

  const todayEarnings = todayDeliveredRows.reduce(
    (sum, row) => sum + (getConfiguredDriverPayout(row) ?? 0),
    0,
  );

  const completedTripsToday = todayDeliveredRows.length;

  const accountLevel = normalizeDriverLevelName(rewardAccount?.level);
  const profileLevel = normalizeDriverLevelName(
    profile?.driver_level ?? profile?.level ?? profile?.tier ?? profile?.reward_level,
  );

  const levelInfo = accountLevel
    ? DRIVER_LEVELS.find((level) => level.name === accountLevel) ?? getDriverLevelFromPoints(lifetimePoints)
    : profileLevel
      ? DRIVER_LEVELS.find((level) => level.name === profileLevel) ?? getDriverLevelFromPoints(lifetimePoints)
      : getDriverLevelFromPoints(lifetimePoints);

  const nextLevel = getNextDriverLevel(lifetimePoints);

  const levelProgress = nextLevel
    ? clampNumber(
        (lifetimePoints - levelInfo.minPoints) /
          Math.max(1, nextLevel.minPoints - levelInfo.minPoints),
        0,
        1,
      )
    : 1;

  const dailyEarningsGoal =
    getRecordNumber(profile, [
      "daily_earnings_goal",
      "earnings_goal_daily",
      "driver_daily_goal",
      "daily_goal",
    ]) ?? DEFAULT_DAILY_EARNINGS_GOAL;

  return {
    todayEarnings,
    lifetimeEarnings,
    completedTripsToday,
    completedTripsTotal,
    points: accountPoints,
    level: levelInfo.name,
    nextLevel: nextLevel?.name ?? null,
    levelProgress,
    dailyEarningsGoal,
    earningsGoalProgress:
      dailyEarningsGoal > 0 ? clampNumber(todayEarnings / dailyEarningsGoal, 0, 1) : 1,
  } satisfies DriverPerformanceStats;
}

const EMPTY_DRIVER_PERFORMANCE_STATS: DriverPerformanceStats = {
  todayEarnings: 0,
  lifetimeEarnings: 0,
  completedTripsToday: 0,
  completedTripsTotal: 0,
  points: 0,
  level: "Bronze",
  nextLevel: "Silver",
  levelProgress: 0,
  dailyEarningsGoal: DEFAULT_DAILY_EARNINGS_GOAL,
  earningsGoalProgress: 0,
};

const SHEET_SCREEN_H = Dimensions.get("window").height;
const SHEET_MIN_TRANSLATE_Y = 0;
const SHEET_MID_TRANSLATE_Y = Math.round(SHEET_SCREEN_H * 0.30);
/**
 * Higher translateY = sheet lower = more Mapbox visible.
 * ONLINE peek locked low (~30% sheet) so Mapbox stays the hero — matches validated capture.
 */
const SHEET_MAX_ONLINE_Y = Math.round(SHEET_SCREEN_H * 0.7);
const SHEET_MAX_OFFLINE_Y = Math.round(SHEET_SCREEN_H * 0.42);
const SHEET_MAX_TRANSLATE_Y = SHEET_MAX_ONLINE_Y;

// Bottom sheet production tuning:
 // - FULL WIDTH, no side gap, no bottom visual gap.
 // - The sheet container stays pinned to the real screen bottom.
 // - Device/bottom-tab clearance is kept INSIDE the sheet padding.
 // - This prevents the black panel from floating and leaving an empty space below it.
const DRIVER_BOTTOM_NAV_SAFE_OFFSET = Platform.select({
  android: 36,
  ios: 22,
  default: 28,
});

const DRIVER_BOTTOM_TAB_CLEARANCE = Platform.select({
  android: 78,
  ios: 58,
  default: 68,
});

const DRIVER_BOTTOM_PANEL_OFFSET =
  (DRIVER_BOTTOM_TAB_CLEARANCE ?? 64) + (DRIVER_BOTTOM_NAV_SAFE_OFFSET ?? 28);
const MAX_VISIBLE_ORDER_MILES = 15;
const CARD_BG = "rgba(15,23,42,0.92)";
const CARD_BORDER = "rgba(148,163,184,0.16)";
const PURPLE = "#8B5CF6";
const GREEN = "#22C55E";
const BLUE = "#3B82F6";
const ORANGE = "#F97316";
const SURFACE = "rgba(2,6,23,0.96)";
const SURFACE_SOFT = "rgba(15,23,42,0.86)";
const SHADOW = "rgba(15,23,42,0.45)";

function getZoneInfoFromLocation(lat: number, lon: number) {
  for (const z of ZONES) {
    if (
      lat >= z.bounds.minLat &&
      lat <= z.bounds.maxLat &&
      lon >= z.bounds.minLon &&
      lon <= z.bounds.maxLon
    ) {
      return {
        name: z.name,
        demand: z.demand,
        multiplier: z.multiplier,
        zoomDelta: z.zoomDelta,
      };
    }
  }

  return {
    name: "Current area",
    demand: "calm" as ZoneDemand,
    multiplier: 1.0,
    zoomDelta: 0.08,
  };
}

function normalizeKind(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function normalizeStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isOrderVisibleForDriver(order: Partial<DriverOrder> | null | undefined) {
  if (!order) return false;

  const kind = normalizeKind(order.kind);
  const status = normalizeStatus(order.status);

  if (kind === "food") return status === "ready";
  if (kind === "pickup_dropoff") return status === "pending";

  // MMD Delivery requests can come from delivery_requests with different paid states.
  // They must be visible once paid and unassigned, not only when status === "pending".
  if (kind === "delivery") {
    return status === "pending" || status === "paid_pending" || status === "processing_pending";
  }

  if (kind === "marketplace") {
    const jobStatus = String(order.marketplace_job_status ?? order.status ?? "").toLowerCase();
    return jobStatus === "dispatch_ready";
  }

  return false;
}

function getBestDriverAmount(order: Partial<DriverOrder> | null | undefined) {
  if (!order) return null;

  // Production privacy rule:
  // The driver UI must only display the payout already calculated by the backend/database.
  // Do not calculate percentages in the app, and never display customer total or delivery fee as payout.
  return getConfiguredDriverPayout(order);
}

function money(amount: number | null | undefined) {
  return typeof amount === "number" ? `$${amount.toFixed(2)}` : "$0.00";
}

function toFiniteNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getConfiguredDriverPayout(order: Partial<DriverOrder> | null | undefined) {
  if (!order) return null;

  // Keep this flexible because orders and delivery_requests may not use the exact same column name yet.
  // The value must come from Supabase, where your commission table / trigger / RPC calculates it.
  const payoutCandidates = [
    (order as any).driver_delivery_payout,
    (order as any).driver_payout,
    (order as any).driver_amount,
    (order as any).driver_pay,
    (order as any).driver_earning,
    (order as any).driver_earnings,
    (order as any).estimated_driver_payout,
    (order as any).estimated_driver_pay,
    (order as any).estimated_driver_earning,
    (order as any).driver_share_amount,
    (order as any).payout_amount,
  ];

  for (const value of payoutCandidates) {
    const payout = toFiniteNumber(value);
    if (payout != null) return payout;
  }

  return null;
}

function getOrderCompositeKey(order: Partial<DriverOrder> | null | undefined) {
  if (!order?.id) return "";
  const offerId = (order as any)?.offer_id;
  return offerId ? `offer:${order.source_table ?? "orders"}:${offerId}` : `${order.source_table ?? "orders"}:${order.id}`;
}

function getRpcRow<T extends Record<string, any>>(data: T | T[] | null | undefined) {
  if (Array.isArray(data)) return data[0] ?? null;
  return data ?? null;
}

function getOfferUnavailableMessage(t: any) {
  return t(
    "driver.home.errors.offerUnavailable",
    "This offer is no longer available. It may have expired or been accepted by another driver.",
  );
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getCurrentLocalHour() {
  return new Date().getHours();
}

function getNearestPickupMiles(
  orders: DriverOrder[],
  driverLocation: { lat: number; lng: number } | null,
) {
  if (!driverLocation) return null;

  let nearest: number | null = null;

  for (const order of orders) {
    const pickupLat = typeof order.pickup_lat === "number" ? order.pickup_lat : null;
    const pickupLngRaw =
      order.pickup_lng ??
      (order as any)?.pickup_lon ??
      (order as any)?.pickup_long ??
      (order as any)?.pickup_longitude ??
      null;
    const pickupLng = typeof pickupLngRaw === "number" ? pickupLngRaw : null;

    if (pickupLat == null || pickupLng == null) continue;

    const miles = milesBetween(driverLocation.lat, driverLocation.lng, pickupLat, pickupLng);
    if (!Number.isFinite(miles)) continue;

    nearest = nearest == null ? miles : Math.min(nearest, miles);
  }

  return nearest;
}

function estimateWaitWindowMinutes(params: {
  isOnline: boolean;
  availableCount: number;
  zoneStatus: ZoneDemand;
  nearestPickupMiles: number | null;
  hour: number;
}) {
  const { isOnline, availableCount, zoneStatus, nearestPickupMiles, hour } = params;

  if (!isOnline) return null;

  let min = zoneStatus === "very_busy" ? 2 : zoneStatus === "busy" ? 4 : 8;
  let max = zoneStatus === "very_busy" ? 5 : zoneStatus === "busy" ? 9 : 18;

  if (availableCount >= 5) {
    min -= 3;
    max -= 5;
  } else if (availableCount >= 3) {
    min -= 2;
    max -= 4;
  } else if (availableCount > 0) {
    min -= 1;
    max -= 3;
  } else {
    min += 2;
    max += 4;
  }

  if (nearestPickupMiles != null) {
    if (nearestPickupMiles <= 1) {
      min -= 1;
      max -= 2;
    } else if (nearestPickupMiles <= 2.5) {
      max -= 1;
    } else if (nearestPickupMiles >= 4) {
      min += 1;
      max += 2;
    }
  }

  const isLunchOrDinnerRush = (hour >= 11 && hour <= 14) || (hour >= 17 && hour <= 21);
  const isLateNight = hour >= 23 || hour <= 5;

  if (isLunchOrDinnerRush) {
    min -= 1;
    max -= 2;
  } else if (isLateNight) {
    min += 2;
    max += 4;
  }

  min = Math.round(clampNumber(min, 1, 25));
  max = Math.round(clampNumber(max, min + 2, 35));

  return { min, max };
}

function formatWaitWindow(window: { min: number; max: number } | null) {
  if (!window) return null;
  return `${window.min} to ${window.max} min`;
}

function hapticLight() {
  try {
    Vibration.vibrate(8);
  } catch {
    // Safe no-op when vibration is unavailable.
  }
}

function hapticSuccess() {
  try {
    Vibration.vibrate([0, 14, 36, 18]);
  } catch {
    // Safe no-op when vibration is unavailable.
  }
}

function hapticWarning() {
  try {
    Vibration.vibrate([0, 18, 42, 18, 42, 18]);
  } catch {
    // Safe no-op when vibration is unavailable.
  }
}

function demandLabel(demand: ZoneDemand) {
  if (demand === "very_busy") return "High demand";
  if (demand === "busy") return "Busy";
  return "Calm";
}

/** Activity label derived only from real nearby request count (not hardcoded zone tables). */
function activityFromNearbyRequests(count: number): { label: string; detail: string } {
  if (count >= 8) {
    return { label: "High demand", detail: `${count} open requests` };
  }
  if (count >= 3) {
    return { label: "Busy", detail: `${count} open requests` };
  }
  if (count >= 1) {
    return { label: "Moderate", detail: `${count} open request(s)` };
  }
  return { label: "Quiet", detail: "No open requests nearby" };
}

function demandColor(demand: ZoneDemand) {
  if (demand === "very_busy") return ORANGE;
  if (demand === "busy") return PURPLE;
  return BLUE;
}

export function DriverHomeScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const navAny = navigation as unknown as AnyNav;
  const { t } = useTranslation();
  const { features: platformFeatures, refresh: refreshDriverPlatformFeatures } =
    useDriverPlatformFeatures();
  const driverMarket = useMemo(
    () => resolveMarketScopeFromFeatures(platformFeatures),
    [platformFeatures]
  );
  const wasOutOfServiceRef = useRef<boolean | null>(null);

  useEffect(() => {
    ensureMapboxTokenApplied();
    void registerUserPushToken("driver");
  }, []);

  const [loading, setLoading] = useState(false);
  const [availableOrders, setAvailableOrders] = useState<DriverOrder[]>([]);
  const [myOrders, setMyOrders] = useState<DriverOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [activeOffer, setActiveOffer] = useState<DriverOrder | null>(null);
  const [hasTaxiActiveOffers, setHasTaxiActiveOffers] = useState(false);

  useEffect(() => {
    const out = Boolean(platformFeatures.out_of_service_area);
    if (wasOutOfServiceRef.current === null) {
      wasOutOfServiceRef.current = out;
      return;
    }
    if (wasOutOfServiceRef.current === true && out === false) {
      Alert.alert(
        t("driver.home.welcomeBackTitle", "Welcome back"),
        t(
          "driver.home.welcomeBackMessage",
          "Welcome back.\nYou are now available to receive new requests."
        )
      );
    }
    if (
      wasOutOfServiceRef.current === false &&
      out === true &&
      isOnline &&
      !forceOnlinePreviewRef.current
    ) {
      void setDriverOnlineStatus(false).then(() => setIsOnline(false)).catch(() => setIsOnline(false));
      Alert.alert(
        platformFeatures.unavailable_title ??
          t("driver.home.outOfServiceTitle", "Out of Service Area"),
        platformFeatures.message ??
          t(
            "driver.home.outOfServiceMessage",
            "You have entered an area where MMD Delivery is not operating yet.\nYou can finish your current trip, but you will not receive new requests until you return to an active county."
          )
      );
    }
    wasOutOfServiceRef.current = out;
  }, [
    platformFeatures.out_of_service_area,
    platformFeatures.message,
    platformFeatures.unavailable_title,
    isOnline,
    t,
  ]);
  const [countdown, setCountdown] = useState(60);
  const [region, setRegion] = useState({
    latitude: 40.650002,
    longitude: -73.949997,
    latitudeDelta: 0.08,
    longitudeDelta: 0.08,
  });
  const [hasLocation, setHasLocation] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [driverHeadingDeg, setDriverHeadingDeg] = useState<number | null>(null);
  const [driverMoving, setDriverMoving] = useState(false);
  const [zoneStatus, setZoneStatus] = useState<ZoneDemand>("calm");
  const [zoneName, setZoneName] = useState(t("driver.home.zone.current", "Zone actuelle"));
  const [zoneMultiplier, setZoneMultiplier] = useState(1.0);
  const [searchMessageIndex, setSearchMessageIndex] = useState(0);
  const [earningsHidden, setEarningsHidden] = useState(false);
  const [driverStats, setDriverStats] = useState<DriverPerformanceStats>(EMPTY_DRIVER_PERFORMANCE_STATS);
  const [servicePreferences, setServicePreferences] =
    useState<DriverServicePreferences | null>(null);
  const [areaIntel, setAreaIntel] = useState<DriverAreaIntelligence | null>(null);
  const [mapStyleUrl, setMapStyleUrl] = useState("mapbox://styles/mapbox/streets-v12");
  const [nextMarketingReward, setNextMarketingReward] =
    useState<DriverMarketingNextReward | null>(null);
  const [activeTaxiRide, setActiveTaxiRide] = useState<Record<string, unknown> | null>(
    null,
  );

  const searchMessages = useMemo(
    () => [
      t("driver.home.searching.msg1", "Recherche des meilleures courses autour de vous"),
      t("driver.home.searching.msg2", "Analyse des routes les plus profitables"),
      t("driver.home.searching.msg3", "Priorité aux demandes proches et urgentes"),
      t("driver.home.searching.msg4", "Synchronisation en direct avec votre zone"),
    ],
    [t],
  );

  const cameraRef = useRef<Mapbox.Camera | null>(null);
  const presenceTrackingRef = useRef(false);
  const onlineRestoreFailuresRef = useRef(0);
  const onlineRestoreStartedAtRef = useRef<number | null>(null);
  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchSeqRef = useRef(0);
  const mountedRef = useRef(true);
  const restoredOnlineStatusRef = useRef(false);
  const lastOfferIdRef = useRef<string | null>(null);
  const forceOnlinePreviewRef = useRef(false);
  const locationPermissionRequestRef = useRef<Promise<boolean> | null>(null);
  const locationPermissionDeniedAlertShownRef = useRef(false);
  const searchingAnim = useRef(new Animated.Value(0)).current;
  const sheetOffset = useRef(new Animated.Value(SHEET_MAX_OFFLINE_Y)).current;
  const sheetStartOffset = useRef(0);
  const sheetMaxRef = useRef(SHEET_MAX_OFFLINE_Y);
  const topHudAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    sheetMaxRef.current = isOnline ? SHEET_MAX_ONLINE_Y : SHEET_MAX_OFFLINE_Y;
  }, [isOnline]);

  useEffect(() => {
    Animated.timing(topHudAnim, {
      toValue: 1,
      duration: 420,
      useNativeDriver: true,
    }).start();
  }, [topHudAnim]);

  useEffect(() => {
    if (activeOffer || hasTaxiActiveOffers) return;
    const peek = isOnline ? SHEET_MAX_ONLINE_Y : SHEET_MAX_OFFLINE_Y;
    Animated.spring(sheetOffset, {
      toValue: peek,
      damping: 20,
      stiffness: 190,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [activeOffer, hasTaxiActiveOffers, isOnline, sheetOffset]);

  useEffect(() => {
    if (!hasTaxiActiveOffers) return;
    // Collapse sheet immediately when a taxi offer arrives so Accept/Reject stay visible.
    Animated.spring(sheetOffset, {
      toValue: sheetMaxRef.current,
      damping: 22,
      stiffness: 220,
      mass: 0.7,
      useNativeDriver: true,
    }).start();
  }, [hasTaxiActiveOffers, sheetOffset]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dy) > 4,

      onPanResponderGrant: () => {
        const currentSheetOffset = sheetOffset as Animated.Value & {
          __getValue?: () => number;
        };

        sheetStartOffset.current =
          typeof currentSheetOffset.__getValue === "function"
            ? currentSheetOffset.__getValue()
            : sheetMaxRef.current;
      },

      onPanResponderMove: (_, gestureState) => {
        const raw = sheetStartOffset.current + gestureState.dy;
        const clamped = Math.max(
          SHEET_MIN_TRANSLATE_Y,
          Math.min(sheetMaxRef.current, raw),
        );
        sheetOffset.setValue(clamped);
      },

      onPanResponderRelease: (_, gestureState) => {
        const projected = sheetStartOffset.current + gestureState.dy + gestureState.vy * 90;
        // ONLINE: prefer low peek (map hero). Mid snap only when clearly expanding.
        const online = sheetMaxRef.current === SHEET_MAX_ONLINE_Y;
        const snapPoints = online
          ? [SHEET_MIN_TRANSLATE_Y, sheetMaxRef.current]
          : [SHEET_MIN_TRANSLATE_Y, SHEET_MID_TRANSLATE_Y, sheetMaxRef.current];

        let final = snapPoints.reduce((closest, point) =>
          Math.abs(point - projected) < Math.abs(closest - projected) ? point : closest,
        );

        if (gestureState.vy < -0.75) final = SHEET_MIN_TRANSLATE_Y;
        if (gestureState.vy > 0.75) final = sheetMaxRef.current;
        // Bias ONLINE releases toward peek unless user clearly swiped up.
        if (online && gestureState.vy > -0.35 && projected > sheetMaxRef.current * 0.45) {
          final = sheetMaxRef.current;
        }

        Animated.spring(sheetOffset, {
          toValue: final,
          damping: 24,
          stiffness: 220,
          mass: 0.78,
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  const todayEarnings = driverStats.todayEarnings;

  const activeRideCount = useMemo(() => myOrders.length, [myOrders.length]);

  useDriverKeepAwake(isOnline || activeOffer != null || activeRideCount > 0);

  const nearestPickupMiles = useMemo(
    () => getNearestPickupMiles(availableOrders, driverLocation),
    [availableOrders, driverLocation],
  );

  const waitWindow = useMemo(
    () =>
      estimateWaitWindowMinutes({
        isOnline,
        availableCount: availableOrders.length,
        zoneStatus,
        nearestPickupMiles,
        hour: getCurrentLocalHour(),
      }),
    [availableOrders.length, isOnline, nearestPickupMiles, zoneStatus],
  );

  const waitRangeText = useMemo(() => {
    if (!isOnline) return t("driver.home.wait.offlineTitle", "You're offline");
    return formatWaitWindow(waitWindow) ?? "—";
  }, [isOnline, t, waitWindow]);

  const waitTitleText = useMemo(() => {
    if (!isOnline) {
      return t("driver.home.wait.offlineSub", "You won't receive delivery requests");
    }

    return t("driver.home.wait.title", "wait in your area");
  }, [isOnline, t]);

  const waitSubText = useMemo(() => {
    if (!isOnline) {
      return t("driver.home.wait.goOnline", "Go online to start receiving nearby requests.");
    }

    const nearestText =
      nearestPickupMiles == null
        ? t("driver.home.wait.gpsLive", "GPS live")
        : `${nearestPickupMiles.toFixed(1)} mi nearest pickup`;

    if (availableOrders.length > 0) {
      return t(
        "driver.home.wait.connectedDemand",
        "{{count}} nearby request(s) · {{zone}} · {{nearest}}",
        { count: availableOrders.length, zone: zoneName, nearest: nearestText },
      );
    }

    return t(
      "driver.home.wait.connectedZone",
      "Live estimate based on {{zone}} demand · {{nearest}}",
      { zone: zoneName, nearest: nearestText },
    );
  }, [availableOrders.length, isOnline, nearestPickupMiles, t, zoneName]);

  const applyDriverCoordinates = useCallback(
    (
      latitude: number,
      longitude: number,
      opts?: { heading?: number | null; speed?: number | null },
    ) => {
      if (!mountedRef.current) return;
      const zoneInfo = getZoneInfoFromLocation(latitude, longitude);
      setDriverLocation({ lat: latitude, lng: longitude });
      const heading = opts?.heading;
      if (heading != null && Number.isFinite(heading) && heading >= 0) {
        setDriverHeadingDeg(heading);
      }
      const speed = opts?.speed;
      setDriverMoving(speed != null && Number.isFinite(speed) && speed > 0.8);
      setZoneName(zoneInfo.name || t("driver.home.zone.current", "Zone actuelle"));
      setZoneStatus(zoneInfo.demand);
      setZoneMultiplier(zoneInfo.multiplier);
      setRegion({
        latitude,
        longitude,
        latitudeDelta: zoneInfo.zoomDelta,
        longitudeDelta: zoneInfo.zoomDelta,
      });
      setHasLocation(true);
    },
    [t],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
    };
  }, []);

  const stopSound = useCallback(async () => {
    try {
      const { stopDriverMissionAlert } = await import(
        "../lib/driverMissionAlertService"
      );
      await stopDriverMissionAlert();
    } catch (e) {
      console.log("stopSound error:", e);
      try {
        await mmdAudio.stopLongRing();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const ensureDriverCanGoOnline = useCallback(
    async (userId: string, options?: { softGate?: boolean }): Promise<boolean> => {
      const { data: profile, error } = await supabase
        .from("driver_profiles")
        .select("status")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) throw error;

      const blockMessage = driverOnlineBlockMessage(profile?.status ?? null);
      if (blockMessage) {
        await setDriverOnlineStatus(false);
        Alert.alert(
          t("shared.orderChat.alerts.errorTitle", "Erreur"),
          blockMessage,
        );
        return false;
      }

      if (!isDriverOnlineEligible(profile?.status ?? null)) {
        return false;
      }

      const scopeFeatures = await refreshDriverPlatformFeatures(
        driverLocation
          ? { lat: driverLocation.lat, lng: driverLocation.lng }
          : undefined
      );

      if (!scopeFeatures.can_go_online || scopeFeatures.out_of_service_area) {
        await setDriverOnlineStatus(false);
        Alert.alert(
          scopeFeatures.unavailable_title ??
            t("driver.home.outOfServiceTitle", "Out of Service Area"),
          scopeFeatures.message ??
            t(
              "driver.home.outOfServiceMessage",
              "You have entered an area where MMD Delivery is not operating yet.\nYou can finish your current trip, but you will not receive new requests until you return to an active county."
            ),
        );
        return false;
      }

      try {
        const deviceId = await getStableDriverDeviceId();
        const identityStatus = await fetchDriverIdentityStatus({
          intent: "go_online",
          deviceId,
        });

        if (identityBlocksDriverOnline(identityStatus.gate_status)) {
          await setDriverOnlineStatus(false);
          Alert.alert(
            "Vérification d'identité",
            identityStatus.message ??
              "Une vérification d'identité est requise avant de passer en ligne.",
            [
              { text: "Annuler", style: "cancel" },
              {
                text: "Vérifier",
                onPress: () => navigation.navigate("DriverIdentityVerification"),
              },
            ],
          );
          return false;
        }
      } catch (identityError) {
        console.log("identity gate error:", identityError);
        if (!options?.softGate) {
          await setDriverOnlineStatus(false);
        }
        Alert.alert(
          t("shared.orderChat.alerts.errorTitle", "Erreur"),
          "Impossible de vérifier votre identité. Réessayez dans un instant.",
        );
        return false;
      }

      return true;
    },
    [driverLocation, navigation, refreshDriverPlatformFeatures, t],
  );

  const getUserIdOrThrow = useCallback(async () => {
    const { data: sessionData, error: sErr } = await supabase.auth.getSession();
    if (sErr) throw sErr;
    const userId = sessionData.session?.user?.id;
    if (!userId) throw new Error(t("driver.home.errors.mustBeLoggedIn", "Tu dois être connecté."));
    return userId;
  }, [t]);

  const setDriverProfileOnline = useCallback(
    async (_userId: string, nextOnline: boolean) => {
      // Authenticated clients cannot write is_online (self-write guard). Always go
      // through the service-role API which also enforces vehicle eligibility.
      const confirmed = await setDriverOnlineViaApi(nextOnline);
      if (confirmed !== nextOnline) {
        throw new Error(
          nextOnline
            ? "Impossible de confirmer le passage en ligne."
            : "Impossible de confirmer le passage hors ligne.",
        );
      }
      return { is_online: confirmed };
    },
    [],
  );

  const ensureGpsPermission = useCallback(async () => {
    if (locationPermissionRequestRef.current) return locationPermissionRequestRef.current;
    locationPermissionRequestRef.current = (async () => {
      try {
        const current = await Location.getForegroundPermissionsAsync();
        if (current.status === "granted") {
          locationPermissionDeniedAlertShownRef.current = false;
          return true;
        }
        if (!current.canAskAgain) return false;
        const requested = await Location.requestForegroundPermissionsAsync();
        if (requested.status === "granted") {
          locationPermissionDeniedAlertShownRef.current = false;
          return true;
        }
        return false;
      } catch (e) {
        console.log("GPS permission check error:", e);
        return false;
      } finally {
        locationPermissionRequestRef.current = null;
      }
    })();
    return locationPermissionRequestRef.current;
  }, []);

  const startDbGpsTracking = useCallback(
    async (_driverId: string) => {
      if (presenceTrackingRef.current) return;
      const ok = await ensureGpsPermission();
      if (!ok) {
        if (!locationPermissionDeniedAlertShownRef.current) {
          locationPermissionDeniedAlertShownRef.current = true;
          Alert.alert(
            t("driver.home.gps.title", "GPS"),
            t("driver.home.gps.permissionDenied", "Permission GPS refusée. Active la localisation dans les paramètres du téléphone."),
          );
        }
        return;
      }

      await startDriverLocationTracking({ intervalMs: DRIVER_PRESENCE_HEARTBEAT_MS });
      presenceTrackingRef.current = true;
    },
    [ensureGpsPermission, t],
  );

  const stopDbGpsTracking = useCallback(async () => {
    if (!presenceTrackingRef.current) return;
    await stopDriverLocationTracking({ setOffline: false });
    presenceTrackingRef.current = false;
  }, []);

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;

    if (!isOnline) {
      setGpsLoading(false);
      setHasLocation(false);
      setDriverLocation(null);
      return () => {
        cancelled = true;
        if (sub) sub.remove();
      };
    }

    const startLocationWatch = async () => {
      try {
        setGpsLoading(true);
        const ok = await ensureGpsPermission();
        if (cancelled || !mountedRef.current) return;
        if (!ok) {
          setHasLocation(false);
          setDriverLocation(null);
          setGpsLoading(false);
          return;
        }

        const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: 60000, requiredAccuracy: 200 });
        if (lastKnown && !cancelled && mountedRef.current) {
          applyDriverCoordinates(lastKnown.coords.latitude, lastKnown.coords.longitude);
          setGpsLoading(false);
        }

        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled || !mountedRef.current) return;
        applyDriverCoordinates(current.coords.latitude, current.coords.longitude);
        setGpsLoading(false);

        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 6000, distanceInterval: 20 },
          (pos) => {
            if (cancelled || !mountedRef.current) return;
            applyDriverCoordinates(pos.coords.latitude, pos.coords.longitude, {
              heading: pos.coords.heading,
              speed: pos.coords.speed,
            });
          },
        );
        if (cancelled) {
          sub.remove();
          sub = null;
        }
      } catch (e) {
        console.log("Erreur GPS driver:", e);
        if (!cancelled && mountedRef.current) setGpsLoading(false);
      }
    };

    void startLocationWatch();
    return () => {
      cancelled = true;
      if (sub) sub.remove();
    };
  }, [applyDriverCoordinates, ensureGpsPermission, isOnline]);

  const fetchDriverPerformance = useCallback(async () => {
    try {
      const driverId = await getUserIdOrThrow();
      const todayStartIso = getTodayStartIso();

      const { data: rewardAccount, error: rewardAccountError } = await supabase
        .from("driver_reward_accounts")
        .select(
          "driver_id, points, lifetime_points, level, completed_deliveries, total_earnings, acceptance_rate, cancellation_rate, rating, updated_at",
        )
        .eq("driver_id", driverId)
        .maybeSingle();

      if (rewardAccountError) throw rewardAccountError;

      const { data: profile } = await supabase
        .from("driver_profiles")
        .select("*")
        .eq("user_id", driverId)
        .maybeSingle();

      const { data: todayOrders, error: todayOrdersError } = await applyLiveTripFilters(
        supabase
          .from("orders")
          .select("id, status, updated_at, created_at, driver_delivery_payout"),
      )
        .eq("driver_id", driverId)
        .eq("status", "delivered")
        .gte("updated_at", todayStartIso)
        .order("updated_at", { ascending: false })
        .limit(500);

      if (todayOrdersError) throw todayOrdersError;

      const { data: todayRequests, error: todayRequestsError } = await applyLiveTripFilters(
        supabase
          .from("delivery_requests")
          .select("id, status, updated_at, created_at, driver_delivery_payout"),
      )
        .eq("driver_id", driverId)
        .eq("status", "delivered")
        .gte("updated_at", todayStartIso)
        .order("updated_at", { ascending: false })
        .limit(500);

      if (todayRequestsError) throw todayRequestsError;

      if (!mountedRef.current) return;

      setDriverStats(
        buildDriverPerformanceStats({
          rewardAccount,
          profile,
          todayDeliveredRows: [...(todayOrders ?? []), ...(todayRequests ?? [])],
        }),
      );
    } catch (e) {
      console.log("fetchDriverPerformance error:", e);
      if (mountedRef.current) {
        setDriverStats((current) => current);
      }
    }
  }, [getUserIdOrThrow]);

  const fetchDriverOrders = useCallback(
    async (forceOnline = false) => {
      const fetchSeq = ++fetchSeqRef.current;
      try {
        const canLoad = forceOnline || isOnline;
        if (!canLoad) {
          if (!mountedRef.current) return;
          setAvailableOrders([]);
          setMyOrders([]);
          setActiveOffer(null);
          setCountdown(60);
          lastOfferIdRef.current = null;
          return;
        }

        setLoading(true);
        setError(null);
        const driverId = await getUserIdOrThrow();
        const nowIso = new Date().toISOString();

        // 0) Offres dispatch personnalisées déjà envoyées à ce chauffeur.
        // Ces offres sont la base du système accept/refuse + timeout/fallback.
        const { data: pendingOrderOffers, error: pendingOrderOffersError } = await supabase
          .from("driver_order_offers")
          .select("id, order_id, expires_at, restaurant_name, pickup_address, dropoff_address, driver_price_cents, distance_miles, eta_minutes")
          .eq("driver_id", driverId)
          .eq("status", "pending")
          .gt("expires_at", nowIso)
          .order("created_at", { ascending: false });

        if (pendingOrderOffersError) throw pendingOrderOffersError;

        const orderOfferIds = Array.from(
          new Set((pendingOrderOffers ?? []).map((offer: any) => String(offer.order_id)).filter(Boolean)),
        );

        const { data: offeredOrders, error: offeredOrdersError } = orderOfferIds.length
          ? await applyLiveTripFilters(
              supabase
                .from("orders")
                .select(
                  `id, kind, status, created_at,
                 restaurant_name, pickup_address, dropoff_address,
                 distance_miles, delivery_fee, driver_delivery_payout, total,
                 pickup_lat, pickup_lng, dropoff_lat, dropoff_lng`,
                ),
            ).in("id", orderOfferIds)
          : { data: [], error: null };

        if (offeredOrdersError) throw offeredOrdersError;

        const orderOfferByOrderId = new Map(
          (pendingOrderOffers ?? []).map((offer: any) => [String(offer.order_id), offer]),
        );

        const pendingOrderOfferList: DriverOrder[] = ((offeredOrders ?? []) as any[]).map((order) => {
          const offer = orderOfferByOrderId.get(String(order.id));
          return {
            ...order,
            restaurant_name: order.restaurant_name ?? offer?.restaurant_name ?? null,
            pickup_address: order.pickup_address ?? offer?.pickup_address ?? null,
            dropoff_address: order.dropoff_address ?? offer?.dropoff_address ?? null,
            distance_miles: toFiniteNumber(order.distance_miles ?? offer?.distance_miles),
            driver_delivery_payout:
              getConfiguredDriverPayout(order) ??
              (typeof offer?.driver_price_cents === "number" ? offer.driver_price_cents / 100 : null),
            source_table: "orders" as const,
            offer_id: offer?.id ?? null,
            offer_expires_at: offer?.expires_at ?? null,
            is_dispatch_offer: true,
          };
        });

        const { data: pendingDeliveryOffers, error: pendingDeliveryOffersError } = await supabase
          .from("delivery_request_driver_offers")
          .select("id, delivery_request_id, expires_at")
          .eq("driver_id", driverId)
          .eq("status", "pending")
          .gt("expires_at", nowIso)
          .order("created_at", { ascending: false });

        if (pendingDeliveryOffersError) throw pendingDeliveryOffersError;

        const deliveryOfferIds = Array.from(
          new Set((pendingDeliveryOffers ?? []).map((offer: any) => String(offer.delivery_request_id)).filter(Boolean)),
        );

        const { data: offeredDeliveryRequests, error: offeredDeliveryRequestsError } = deliveryOfferIds.length
          ? await applyLiveTripFilters(
              supabase
                .from("delivery_requests")
                .select(
                  `id,status,payment_status,driver_id,created_at,updated_at,
                 pickup_address,dropoff_address,
                 pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,
                 distance_miles,eta_minutes,delivery_fee,total,currency,
                 driver_delivery_payout,platform_fee`,
                ),
            ).in("id", deliveryOfferIds)
          : { data: [], error: null };

        if (offeredDeliveryRequestsError) throw offeredDeliveryRequestsError;

        const deliveryOfferByRequestId = new Map(
          (pendingDeliveryOffers ?? []).map((offer: any) => [String(offer.delivery_request_id), offer]),
        );

        const pendingDeliveryOfferList: DriverOrder[] = ((offeredDeliveryRequests ?? []) as any[]).map((request) => {
          const offer = deliveryOfferByRequestId.get(String(request.id));
          return {
            id: String(request.id),
            kind: "delivery",
            status: String(request.status ?? "pending") as OrderStatus,
            created_at: request.created_at ?? null,
            restaurant_name: null,
            pickup_address: request.pickup_address ?? null,
            dropoff_address: request.dropoff_address ?? null,
            distance_miles: toFiniteNumber(request.distance_miles),
            delivery_fee: toFiniteNumber(request.delivery_fee),
            driver_delivery_payout: getConfiguredDriverPayout(request),
            total: toFiniteNumber(request.total),
            pickup_lat: toFiniteNumber(request.pickup_lat),
            pickup_lng: toFiniteNumber(request.pickup_lng),
            dropoff_lat: toFiniteNumber(request.dropoff_lat),
            dropoff_lng: toFiniteNumber(request.dropoff_lng),
            source_table: "delivery_requests" as const,
            offer_id: offer?.id ?? null,
            offer_expires_at: offer?.expires_at ?? null,
            is_dispatch_offer: true,
          };
        });

        // 1) Commandes disponibles depuis orders.
        // orders.kind est un enum : errand | food | pickup_dropoff.
        // On ne met jamais "delivery" ici, car delivery existe dans delivery_requests.
        const { data: available, error: availableError } = await applyLiveTripFilters(
          supabase
            .from("orders")
            .select(
              `id, kind, status, created_at,
             restaurant_name, pickup_address, dropoff_address,
             distance_miles, delivery_fee, driver_delivery_payout, total,
             pickup_lat, pickup_lng, dropoff_lat, dropoff_lng`,
            ),
        )
          .in("status", ["pending", "ready"])
          .is("driver_id", null)
          .order("created_at", { ascending: false });

        if (availableError) throw availableError;

        // 2) Demandes MMD Delivery disponibles depuis delivery_requests.
        // Ces demandes sont séparées de orders et doivent être chargées séparément.
        const { data: deliveryAvailable, error: deliveryAvailableError } = await applyLiveTripFilters(
          supabase
            .from("delivery_requests")
            .select(
              `id,status,payment_status,driver_id,created_at,updated_at,
             pickup_address,dropoff_address,
             pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,
             distance_miles,eta_minutes,delivery_fee,total,currency,
             driver_delivery_payout,platform_fee`
            ),
        )
          .in("status", ["pending", "paid_pending", "processing_pending"])
          .eq("payment_status", "paid")
          .is("driver_id", null)
          .order("created_at", { ascending: false });

        if (deliveryAvailableError) throw deliveryAvailableError;

        // 3) Commandes orders déjà assignées au driver.
        const { data: mine, error: mineError } = await applyLiveTripFilters(
          supabase
            .from("orders")
            .select(
              `id, kind, status, created_at,
             restaurant_name, pickup_address, dropoff_address,
             distance_miles, delivery_fee, driver_delivery_payout, total,
             pickup_lat, pickup_lng, dropoff_lat, dropoff_lng`,
            ),
        )
          .eq("driver_id", driverId)
          .not("status", "in", '("delivered","canceled")')
          .order("created_at", { ascending: false });

        if (mineError) throw mineError;

        // 4) Demandes delivery_requests déjà assignées au driver.
        const { data: myDeliveryRequests, error: myDeliveryRequestsError } = await applyLiveTripFilters(
          supabase
            .from("delivery_requests")
            .select(
              `id,status,payment_status,driver_id,created_at,updated_at,
             pickup_address,dropoff_address,
             pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,
             distance_miles,eta_minutes,delivery_fee,total,currency,
             driver_delivery_payout,platform_fee`
            ),
        )
          .eq("driver_id", driverId)
          .not("status", "in", '("delivered","canceled")')
          .order("created_at", { ascending: false });

        if (myDeliveryRequestsError) throw myDeliveryRequestsError;

        let marketplaceAvailableList: DriverOrder[] = [];
        let marketplaceMineList: DriverOrder[] = [];
        try {
          const marketplaceJobs = await fetchDriverMarketplaceJobs();
          marketplaceAvailableList = (marketplaceJobs.available ?? []).map((job) =>
            mapMarketplaceJobToDriverOrder(job) as DriverOrder
          );
          marketplaceMineList = (marketplaceJobs.mine ?? []).map((job) =>
            mapMarketplaceJobToDriverOrder(job) as DriverOrder
          );
        } catch (marketplaceError) {
          console.log("DriverHome marketplace jobs fetch:", marketplaceError);
        }

        if (!mountedRef.current || fetchSeq !== fetchSeqRef.current) return;

        const orderAvailable = ((available ?? []) as DriverOrder[]).map((order) => ({
          ...order,
          source_table: "orders" as const,
        }));

        const deliveryAvailableList: DriverOrder[] = ((deliveryAvailable ?? []) as any[]).map((request) => ({
          id: String(request.id),
          kind: "delivery",
          status: String(request.status ?? "pending") as OrderStatus,
          created_at: request.created_at ?? null,
          restaurant_name: null,
          pickup_address: request.pickup_address ?? null,
          dropoff_address: request.dropoff_address ?? null,
          distance_miles: toFiniteNumber(request.distance_miles),
          delivery_fee: toFiniteNumber(request.delivery_fee),
          driver_delivery_payout: getConfiguredDriverPayout(request),
          total: toFiniteNumber(request.total),
          pickup_lat: toFiniteNumber(request.pickup_lat),
          pickup_lng: toFiniteNumber(request.pickup_lng),
          dropoff_lat: toFiniteNumber(request.dropoff_lat),
          dropoff_lng: toFiniteNumber(request.dropoff_lng),
          source_table: "delivery_requests" as const,
        }));

        const myOrderList = ((mine ?? []) as DriverOrder[]).map((order) => ({
          ...order,
          source_table: "orders" as const,
        }));

        const myDeliveryList: DriverOrder[] = ((myDeliveryRequests ?? []) as any[]).map((request) => ({
          id: String(request.id),
          kind: "delivery",
          status: String(request.status ?? "pending") as OrderStatus,
          created_at: request.created_at ?? null,
          restaurant_name: null,
          pickup_address: request.pickup_address ?? null,
          dropoff_address: request.dropoff_address ?? null,
          distance_miles: toFiniteNumber(request.distance_miles),
          delivery_fee: toFiniteNumber(request.delivery_fee),
          driver_delivery_payout: getConfiguredDriverPayout(request),
          total: toFiniteNumber(request.total),
          pickup_lat: toFiniteNumber(request.pickup_lat),
          pickup_lng: toFiniteNumber(request.pickup_lng),
          dropoff_lat: toFiniteNumber(request.dropoff_lat),
          dropoff_lng: toFiniteNumber(request.dropoff_lng),
          source_table: "delivery_requests" as const,
        }));

        const allAvailable = [
          ...pendingOrderOfferList,
          ...pendingDeliveryOfferList,
          ...orderAvailable,
          ...deliveryAvailableList,
          ...marketplaceAvailableList,
        ];

        const seenAvailableKeys = new Set<string>();
        const visibleAvailable = allAvailable.filter((o) => {
          const compositeKey = getOrderCompositeKey(o);
          if (seenAvailableKeys.has(compositeKey)) return false;
          seenAvailableKeys.add(compositeKey);

          if (o.is_dispatch_offer) return true;

          const statusVisible = isOrderVisibleForDriver(o);
          const pickupLat = typeof o.pickup_lat === "number" ? o.pickup_lat : null;
          const pickupLngRaw =
            o.pickup_lng ??
            (o as any)?.pickup_lon ??
            (o as any)?.pickup_long ??
            (o as any)?.pickup_longitude ??
            null;
          const pickupLng = typeof pickupLngRaw === "number" ? pickupLngRaw : null;
          const hasPickupCoordinates = pickupLat != null && pickupLng != null;
          const isDeliveryRequest = o.source_table === "delivery_requests";
          const isMarketplaceJob = o.source_table === "marketplace_delivery_jobs";
          let withinDispatchMiles = false;

          if (driverLocation && hasPickupCoordinates) {
            const distance = milesBetween(driverLocation.lat, driverLocation.lng, pickupLat, pickupLng);
            withinDispatchMiles = distance <= MAX_VISIBLE_ORDER_MILES;
          }

          // Production safety:
          // orders must have pickup coordinates for nearby filtering.
          // delivery_requests without coordinates are still shown so paid customer requests are not hidden.
          if (isDeliveryRequest || isMarketplaceJob) {
            return statusVisible && (!driverLocation || !hasPickupCoordinates || withinDispatchMiles);
          }

          return statusVisible && hasPickupCoordinates && (!driverLocation || withinDispatchMiles);
        });

        const myList = [...myOrderList, ...myDeliveryList, ...marketplaceMineList];

        setAvailableOrders(visibleAvailable);
        setMyOrders(myList);
        setActiveOffer((prev) => {
          if (visibleAvailable.length === 0) {
            if (prev) lastOfferIdRef.current = null;
            setCountdown(60);
            return null;
          }
          if (prev) {
            const stillExists = visibleAvailable.find(
              (o) => getOrderCompositeKey(o) === getOrderCompositeKey(prev),
            );
            if (stillExists) return stillExists;
          }
          const nextOffer = visibleAvailable[0] ?? null;
          if (!prev || getOrderCompositeKey(prev) !== getOrderCompositeKey(nextOffer)) setCountdown(60);
          return nextOffer;
        });
      } catch (e: any) {
        console.log("Erreur chargement commandes driver:", e);
        if (mountedRef.current) {
          setError(t("driver.home.errors.loadOrders", "Impossible de charger les commandes."));
        }
      } finally {
        if (mountedRef.current && fetchSeq === fetchSeqRef.current) setLoading(false);
      }
    },
    [isOnline, getUserIdOrThrow, t, driverLocation],
  );

  const scheduleDriverOrdersRefresh = useCallback(
    (delayMs = 350) => {
      if (!isOnline) return;
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
      refreshDebounceRef.current = setTimeout(() => {
        refreshDebounceRef.current = null;
        void fetchDriverOrders(true);
      }, delayMs);
    },
    [fetchDriverOrders, isOnline],
  );

  const resumeOnlineSession = useCallback(
    async (options?: { softGate?: boolean }) => {
      const savedOnline = await getDriverOnlineStatus();
      if (!mountedRef.current) return;

      if (!savedOnline) {
        if (isOnline) {
          setIsOnline(false);
          await stopDbGpsTracking();
          await stopSound();
          setActiveOffer(null);
          setAvailableOrders([]);
          setMyOrders([]);
          setCountdown(60);
          lastOfferIdRef.current = null;
        }
        onlineRestoreFailuresRef.current = 0;
        onlineRestoreStartedAtRef.current = null;
        return;
      }

      if (onlineRestoreStartedAtRef.current == null) {
        onlineRestoreStartedAtRef.current = Date.now();
      }

      try {
        const userId = await getUserIdOrThrow();
        const canGoOnline = await ensureDriverCanGoOnline(userId, {
          softGate: options?.softGate ?? true,
        });

        if (!canGoOnline) {
          const stillSaved = await getDriverOnlineStatus();
          if (!stillSaved && mountedRef.current) {
            setIsOnline(false);
          }
          return;
        }

        await setDriverProfileOnline(userId, true);
        await setDriverOnlineStatus(true);

        if (mountedRef.current) setIsOnline(true);

        await startDbGpsTracking(userId);
        await fetchDriverOrders(true);

        onlineRestoreFailuresRef.current = 0;
        onlineRestoreStartedAtRef.current = null;
      } catch (error) {
        console.log("resumeOnlineSession error:", error);
        onlineRestoreFailuresRef.current += 1;
        const startedAt = onlineRestoreStartedAtRef.current ?? Date.now();
        const elapsed = Date.now() - startedAt;

        if (elapsed >= DRIVER_ONLINE_GRACE_MS) {
          await setDriverOnlineStatus(false).catch(() => {});
          if (mountedRef.current) setIsOnline(false);
          onlineRestoreFailuresRef.current = 0;
          onlineRestoreStartedAtRef.current = null;
        }
      }
    },
    [
      ensureDriverCanGoOnline,
      fetchDriverOrders,
      getUserIdOrThrow,
      isOnline,
      setDriverProfileOnline,
      startDbGpsTracking,
      stopDbGpsTracking,
      stopSound,
    ],
  );

  useEffect(() => {
    if (!isOnline) return undefined;

    return subscribeDriverMissionPushRefresh(() => {
      void fetchDriverOrders(true);
      void mmdAudio.startLongRing("driver").catch(() => {});
    });
  }, [fetchDriverOrders, isOnline]);

  useEffect(() => {
    if (restoredOnlineStatusRef.current) return;
    restoredOnlineStatusRef.current = true;

    let cancelled = false;

    const restoreSavedOnlineStatus = async () => {
      if (cancelled) return;
      await resumeOnlineSession({ softGate: true });
    };

    void restoreSavedOnlineStatus();

    return () => {
      cancelled = true;
    };
  }, [resumeOnlineSession]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state !== "active") return;
      void resumeOnlineSession({ softGate: true });
    });

    return () => sub.remove();
  }, [resumeOnlineSession]);

  useFocusEffect(
    useCallback(() => {
      void fetchDriverPerformance();
      if (isOnline) void fetchDriverOrders(true);
    }, [fetchDriverPerformance, isOnline, fetchDriverOrders]),
  );

  useEffect(() => {
    if (!isOnline) return;

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const subscribeToDriverRealtime = async () => {
      try {
        const driverId = await getUserIdOrThrow();
        if (cancelled || !mountedRef.current) return;

        channel = subscribePostgresChannel(
          `driver-dispatch-live-${driverId}`,
          [
            { event: "INSERT", table: "orders", callback: () => scheduleDriverOrdersRefresh(150) },
            { event: "UPDATE", table: "orders", callback: () => scheduleDriverOrdersRefresh(150) },
            { event: "DELETE", table: "orders", callback: () => scheduleDriverOrdersRefresh(150) },
            {
              event: "INSERT",
              table: "delivery_requests",
              callback: () => scheduleDriverOrdersRefresh(150),
            },
            {
              event: "UPDATE",
              table: "delivery_requests",
              callback: () => scheduleDriverOrdersRefresh(150),
            },
            {
              event: "DELETE",
              table: "delivery_requests",
              callback: () => scheduleDriverOrdersRefresh(150),
            },
            {
              event: "INSERT",
              table: "driver_order_offers",
              filter: `driver_id=eq.${driverId}`,
              callback: () => scheduleDriverOrdersRefresh(0),
            },
            {
              event: "UPDATE",
              table: "driver_order_offers",
              filter: `driver_id=eq.${driverId}`,
              callback: () => scheduleDriverOrdersRefresh(0),
            },
            {
              event: "DELETE",
              table: "driver_order_offers",
              filter: `driver_id=eq.${driverId}`,
              callback: () => scheduleDriverOrdersRefresh(0),
            },
            {
              event: "INSERT",
              table: "delivery_request_driver_offers",
              filter: `driver_id=eq.${driverId}`,
              callback: () => scheduleDriverOrdersRefresh(0),
            },
            {
              event: "UPDATE",
              table: "delivery_request_driver_offers",
              filter: `driver_id=eq.${driverId}`,
              callback: () => scheduleDriverOrdersRefresh(0),
            },
            {
              event: "DELETE",
              table: "delivery_request_driver_offers",
              filter: `driver_id=eq.${driverId}`,
              callback: () => scheduleDriverOrdersRefresh(0),
            },
            {
              event: "INSERT",
              table: "taxi_offers",
              filter: `driver_id=eq.${driverId}`,
              callback: () => {
                notifyTaxiOfferPushReceived();
                scheduleDriverOrdersRefresh(0);
              },
            },
            {
              event: "UPDATE",
              table: "taxi_offers",
              filter: `driver_id=eq.${driverId}`,
              callback: () => {
                notifyTaxiOfferPushReceived();
                scheduleDriverOrdersRefresh(0);
              },
            },
            {
              event: "DELETE",
              table: "taxi_offers",
              filter: `driver_id=eq.${driverId}`,
              callback: () => {
                notifyTaxiOfferPushReceived();
                scheduleDriverOrdersRefresh(0);
              },
            },
          ],
          (status) => {
            console.log("DRIVER_HOME_REALTIME_STATUS", status);
            if (status === "SUBSCRIBED") scheduleDriverOrdersRefresh(0);
          },
        );
      } catch (e) {
        console.log("driver realtime subscribe error:", e);
      }
    };

    void subscribeToDriverRealtime();

    return () => {
      cancelled = true;
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
      refreshDebounceRef.current = null;
      if (channel) {
        void unsubscribeSupabaseChannel(channel);
      }
    };
  }, [getUserIdOrThrow, isOnline, scheduleDriverOrdersRefresh]);

  const formatStatus = useCallback(
    (status: OrderStatus) => {
      switch (status) {
        case "pending":
        case "paid_pending":
        case "processing_pending":
          return t("driver.home.status.pending", "En attente");
        case "accepted":
          return t("driver.home.status.accepted", "Acceptée");
        case "prepared":
          return t("driver.home.status.prepared", "En préparation");
        case "ready":
          return t("driver.home.status.ready", "Prête");
        case "dispatched":
          return t("driver.home.status.dispatched", "En livraison");
        case "delivered":
          return t("driver.home.status.delivered", "Livrée");
        case "canceled":
          return t("driver.home.status.canceled", "Annulée");
        default:
          return String(status);
      }
    },
    [t],
  );

  const formatKind = useCallback(
    (kind: OrderKind, restaurantName: string | null) => {
      const normalizedKind = normalizeKind(kind);
      if (normalizedKind === "food") {
        return restaurantName
          ? t("driver.home.kind.foodWithName", "Restaurant order · {{name}}", { name: restaurantName })
          : t("driver.home.kind.food", "Restaurant order");
      }
      if (normalizedKind === "pickup_dropoff") return t("driver.home.kind.pickup_dropoff", "Pickup / dropoff");
      if (normalizedKind === "delivery") return t("driver.home.kind.delivery", "MMD Delivery");
      if (normalizedKind === "marketplace") {
        return t("driver.home.kind.marketplace", "Marketplace delivery");
      }
      return String(kind ?? "—");
    },
    [t],
  );

  const formatDate = useCallback((iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, []);

  const handleOpenOrder = useCallback((order: DriverOrder) => {
    hapticLight();
    navAny.navigate("DriverOrderDetails", {
      orderId: order.id,
      sourceTable: order.source_table ?? "orders",
    });
  }, [navAny]);

  const premiumJobs = useMemo(() => {
    const foodDeliveryJobs = myOrders.map((order) => {
      const kindRaw = String(order.kind ?? "").toLowerCase();
      const isFood =
        kindRaw.includes("food") ||
        kindRaw.includes("restaurant") ||
        Boolean(order.restaurant_name);
      return {
        id: order.id,
        key: `${order.source_table ?? "orders"}:${order.id}`,
        kind: (isFood ? "food" : "delivery") as "food" | "delivery",
        kindLabel: formatKind(order.kind, order.restaurant_name),
        statusLabel: formatStatus(order.status),
        pickup: order.pickup_address ?? order.restaurant_name ?? "—",
        dropoff: order.dropoff_address ?? "—",
        amountLabel: money(getBestDriverAmount(order)),
        distanceLabel:
          order.distance_miles != null
            ? `${Number(order.distance_miles).toFixed(1)} mi`
            : "—",
        etaLabel: null as string | null,
        onPress: () => handleOpenOrder(order),
      };
    });

    if (!activeTaxiRide?.id) return foodDeliveryJobs;

    const rideId = String(activeTaxiRide.id);
    const payoutCents = Number(
      activeTaxiRide.driver_payout_cents ?? activeTaxiRide.driver_earnings_cents ?? NaN,
    );
    const currency = String(activeTaxiRide.currency ?? "USD");
    const amountLabel = Number.isFinite(payoutCents)
      ? formatDriverPayout(payoutCents, currency)
      : "—";
    const distanceMiles = Number(activeTaxiRide.distance_miles ?? NaN);

    return [
      {
        id: rideId,
        key: `taxi_rides:${rideId}`,
        kind: "taxi" as const,
        kindLabel: "Taxi ride",
        statusLabel: String(activeTaxiRide.status ?? "active"),
        pickup: String(activeTaxiRide.pickup_address ?? "—"),
        dropoff: String(activeTaxiRide.dropoff_address ?? "—"),
        amountLabel,
        distanceLabel: Number.isFinite(distanceMiles)
          ? `${distanceMiles.toFixed(1)} mi`
          : "—",
        etaLabel: null as string | null,
        onPress: () => {
          hapticLight();
          navAny.navigate("DriverMap" as never, {
            orderId: rideId,
            sourceTable: "taxi_rides",
          } as never);
        },
      },
      ...foodDeliveryJobs,
    ];
  }, [activeTaxiRide, formatKind, formatStatus, handleOpenOrder, myOrders, navAny]);

  const handleAccept = useCallback(
    async (offer: DriverOrder) => {
      const orderId = offer.id;
      const offerSourceTable = offer.source_table ?? "orders";
      const offerKey = getOrderCompositeKey(offer);

      try {
        hapticSuccess();
        setAcceptingId(offerKey);

        if (offer.offer_id) {
          if (offerSourceTable === "delivery_requests") {
            const { acceptDeliveryRequestOffer } = await import("../lib/driverOrderDriverApi");
            try {
              await acceptDeliveryRequestOffer(offer.offer_id);
            } catch (apiErr: any) {
              if (
                apiErr?.message === "request_no_longer_available" ||
                apiErr?.message === "offer_not_available"
              ) {
                const { acceptDeliveryRequest } = await import(
                  "../lib/deliveryRequestDriverApi"
                );
                await acceptDeliveryRequest(orderId);
              } else {
                throw apiErr;
              }
            }
          } else {
            const { acceptFoodOrderOffer } = await import("../lib/driverOrderDriverApi");
            const out = await acceptFoodOrderOffer(offer.offer_id);
            if (out?.ok === false) {
              throw new Error(out?.error ?? getOfferUnavailableMessage(t));
            }
          }
        } else if (offerSourceTable === "delivery_requests") {
          const { acceptDeliveryRequest } = await import("../lib/deliveryRequestDriverApi");
          await acceptDeliveryRequest(orderId);
        } else if (offerSourceTable === "marketplace_delivery_jobs") {
          await acceptDriverMarketplaceJob(orderId);
        } else {
          const { acceptReadyFoodOrder } = await import("../lib/driverOrderDriverApi");
          await acceptReadyFoodOrder(orderId);

          const { error: joinError } = await supabase.rpc("join_order", { p_order_id: orderId, p_role: "driver" });
          if (joinError) console.log("join_order driver warning:", joinError);
        }

        await stopSound();
        setActiveOffer(null);
        setCountdown(60);
        lastOfferIdRef.current = null;
        await fetchDriverOrders(true);
        void fetchDriverPerformance();

        navAny.navigate("DriverOrderDetails", {
          orderId,
          sourceTable: offerSourceTable,
        });
      } catch (e: any) {
        console.log("Erreur acceptation course:", e);
        Alert.alert(
          t("shared.orderChat.alerts.errorTitle", "Erreur"),
          e?.message ?? t("driver.home.errors.accept", "Impossible d'accepter la course."),
        );
      } finally {
        setAcceptingId(null);
      }
    },
    [fetchDriverOrders, fetchDriverPerformance, navAny, stopSound, t],
  );

  const handleDeclineActiveOffer = useCallback(async () => {
    hapticWarning();

    try {
      const offer = activeOffer;

      if (offer?.offer_id) {
        const rpcName =
          (offer.source_table ?? "orders") === "delivery_requests"
            ? "driver_reject_delivery_request_offer"
            : "driver_reject_order_offer";

        const { data, error } = await supabase.rpc(rpcName, {
          p_offer_id: offer.offer_id,
          p_reason: "driver_ignored",
        });

        if (error) throw error;

        const result = getRpcRow<{ ok?: boolean; message?: string }>(data as any);

        if (!result?.ok && result?.message !== "offer_not_available") {
          throw new Error(result?.message ?? getOfferUnavailableMessage(t));
        }
      }
    } catch (e: any) {
      console.log("Erreur refus offre driver:", e);
      Alert.alert(
        t("shared.orderChat.alerts.errorTitle", "Erreur"),
        e?.message ?? t("driver.home.errors.decline", "Impossible de refuser cette offre."),
      );
    } finally {
      await stopSound();
      setActiveOffer(null);
      setCountdown(60);
      lastOfferIdRef.current = null;
      if (isOnline) await fetchDriverOrders(true);
    }
  }, [activeOffer, fetchDriverOrders, isOnline, stopSound, t]);

  useEffect(() => {
    if (!activeOffer) return;
    if (countdown <= 0) {
      setActiveOffer(null);
      setCountdown(60);
      lastOfferIdRef.current = null;
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [activeOffer, countdown]);

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(searchingAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
    );
    anim.start();
    return () => anim.stop();
  }, [searchingAnim]);

  useEffect(() => {
    if (!isOnline || activeOffer) return;
    const interval = setInterval(() => {
      setSearchMessageIndex((prev) => (prev + 1) % searchMessages.length);
    }, 2800);
    return () => clearInterval(interval);
  }, [isOnline, activeOffer, searchMessages.length]);

  useEffect(() => {
    if (!activeOffer?.id) {
      void stopSound();
      return;
    }

    if (lastOfferIdRef.current === getOrderCompositeKey(activeOffer)) return;

    lastOfferIdRef.current = getOrderCompositeKey(activeOffer);
    void mmdAudio.startLongRing("driver");

    return () => {
      void stopSound();
    };
  }, [activeOffer?.id, activeOffer?.source_table, stopSound]);

  const toggleOnline = useCallback(async () => {
    hapticLight();
    try {
      const next = !isOnline;
      const userId = await getUserIdOrThrow();

      const { data: driver, error: driverErr } = await supabase
        .from("driver_profiles")
        .select("*")
        .eq("user_id", userId)
        .single();

      if (driverErr || !driver) {
        Alert.alert("Erreur", "Profil chauffeur introuvable.");
        return;
      }

      const { data: docs, error: docsErr } = await supabase
        .from("driver_documents")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (docsErr) throw docsErr;

      const latestByType = new Map<string, any>();
      for (const row of docs ?? []) {
        const key = String(row?.doc_type ?? row?.type ?? "")
          .trim()
          .toLowerCase();
        if (key && !latestByType.has(key)) latestByType.set(key, row);
      }

      const documents = Array.from(latestByType.values());
      const approvedDocTypeSet = new Set(
        documents
          .filter((d: any) => {
            const status = String(d?.status ?? "")
              .trim()
              .toLowerCase();
            return status === "approved" || status === "verified" || status === "valid";
          })
          .map((d: any) =>
            String(d?.doc_type ?? d?.type ?? "")
              .trim()
              .toLowerCase(),
          ),
      );

      const hasDoc = (docType: string) => approvedDocTypeSet.has(docType.toLowerCase());
      const missing: string[] = [];

      if (!driver.full_name) missing.push("Nom complet");
      if (!driver.phone) missing.push("Téléphone");
      if (!driver.emergency_phone) missing.push("Téléphone d’urgence");
      if (!driver.address) missing.push("Adresse");
      if (!driver.city) missing.push("Ville");
      if (!driver.state) missing.push("État");
      if (!driver.zip_code) missing.push("ZIP code");
      if (!driver.date_of_birth) missing.push("Date de naissance");

      if (!hasDoc("profile_photo")) missing.push("Photo personnelle");
      if (!hasDoc("id_card_front")) missing.push("Pièce identité recto");
      if (!hasDoc("id_card_back")) missing.push("Pièce identité verso");

      const isVehicle = driver.transport_mode === "car" || driver.transport_mode === "moto";
      if (isVehicle) {
        if (!driver.vehicle_brand && !driver.active_vehicle_id) missing.push("Véhicule");
        if (!hasDoc("license_front")) missing.push("Permis recto");
        if (!hasDoc("license_back")) missing.push("Permis verso");
        if (!hasDoc("insurance")) missing.push("Assurance");
        if (!hasDoc("registration")) missing.push("Registration");
      }

      if (missing.length > 0) {
        Alert.alert(
          "Profil incomplet",
          "Complète ton profil avant de passer en ligne :\n\n" + missing.map((m) => "• " + m).join("\n"),
        );
        return;
      }

      const onlineBlockMessage = driverOnlineBlockMessage(driver?.status ?? null);
      if (next && onlineBlockMessage) {
        await setDriverOnlineStatus(false);
        Alert.alert("Erreur", onlineBlockMessage);
        return;
      }

      if (next) {
        const canGoOnline = await ensureDriverCanGoOnline(userId);
        if (!canGoOnline) {
          return;
        }

        try {
          const servicePrefs = await fetchDriverServicePreferences();
          if (!hasAnyDriverServiceEnabled(servicePrefs.preferences)) {
            Alert.alert(
              "Mes services",
              "Activez au moins un service (Food, Colis ou Taxi) avant de passer en ligne.",
              [
                { text: "Configurer", onPress: () => navAny.navigate("DriverServices" as never) },
                { text: "OK", style: "cancel" },
              ],
            );
            return;
          }
        } catch (serviceErr) {
          console.log("service preferences check error:", serviceErr);
        }

        const ok = await ensureGpsPermission();
        if (!ok) {
          if (!locationPermissionDeniedAlertShownRef.current) {
            locationPermissionDeniedAlertShownRef.current = true;
            Alert.alert("GPS", "Active la localisation dans les paramètres du téléphone pour passer en ligne.");
          }
          return;
        }
        await setDriverProfileOnline(userId, true);
        await setDriverOnlineStatus(true);
        setIsOnline(true);
        await startDbGpsTracking(userId);
        await fetchDriverOrders(true);
        void fetchDriverPerformance();
        return;
      }

      await setDriverProfileOnline(userId, false);
      await setDriverOnlineStatus(false);
      setIsOnline(false);
      setAreaIntel(null);
      await stopDbGpsTracking();
      await stopSound();
      setActiveOffer(null);
      setAvailableOrders([]);
      setMyOrders([]);
      setCountdown(60);
      lastOfferIdRef.current = null;
    } catch (e: any) {
      console.log("toggleOnline error:", e);
      Alert.alert(
        t("shared.orderChat.alerts.errorTitle", "Erreur"),
        toUserFacingError(e, "Impossible de changer le statut pour le moment."),
      );
    }
  }, [ensureDriverCanGoOnline, ensureGpsPermission, fetchDriverOrders, getUserIdOrThrow, isOnline, setDriverProfileOnline, startDbGpsTracking, stopDbGpsTracking, stopSound, t]);

  const openDriverMenu = useCallback(() => {
    hapticLight();
    navAny.navigate("DriverMenuTab" as never);
  }, [navAny]);

  const openDriverInbox = useCallback(() => {
    hapticLight();
    navAny.navigate("DriverInboxTab" as never);
  }, [navAny]);

  const openDriverServices = useCallback(
    (_mode?: DriverServiceModeKey) => {
      hapticLight();
      navAny.navigate("DriverServices" as never);
    },
    [navAny],
  );

  const refreshServicePreferences = useCallback(async () => {
    try {
      const result = await fetchDriverServicePreferences();
      if (!mountedRef.current) return;
      setServicePreferences(result.preferences);
    } catch (e) {
      console.log("driver home service preferences load error:", e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshServicePreferences();
    }, [refreshServicePreferences]),
  );

  const refreshAreaIntelligence = useCallback(async () => {
    const lat = driverLocation?.lat ?? region.latitude;
    const lng = driverLocation?.lng ?? region.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    try {
      const next = await fetchDriverAreaIntelligence({
        lat,
        lng,
        radiusMiles: 5,
        isOnline,
      });
      if (!mountedRef.current) return;
      setAreaIntel(next);
    } catch (e) {
      console.log("area intelligence error:", e);
    }
  }, [driverLocation?.lat, driverLocation?.lng, isOnline, region.latitude, region.longitude]);

  const refreshActiveTaxiRide = useCallback(async () => {
    try {
      const out = await fetchActiveTaxiRide();
      if (!mountedRef.current) return;
      const ride = out?.ride ?? out?.taxi_ride ?? null;
      setActiveTaxiRide(ride && typeof ride === "object" ? (ride as Record<string, unknown>) : null);
    } catch {
      if (mountedRef.current) setActiveTaxiRide(null);
    }
  }, []);

  const refreshNextReward = useCallback(async () => {
    try {
      const next = await fetchDriverNextReward();
      if (!mountedRef.current) return;
      setNextMarketingReward(next);
    } catch {
      if (mountedRef.current) setNextMarketingReward(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshAreaIntelligence();
      void refreshActiveTaxiRide();
      void refreshNextReward();
    }, [refreshActiveTaxiRide, refreshAreaIntelligence, refreshNextReward]),
  );

  useEffect(() => {
    if (!hasLocation) return;
    void refreshAreaIntelligence();
    const id = setInterval(() => {
      void refreshAreaIntelligence();
      void refreshActiveTaxiRide();
    }, 45_000);
    return () => clearInterval(id);
  }, [hasLocation, isOnline, refreshActiveTaxiRide, refreshAreaIntelligence]);

  const centerOnDriver = useCallback(() => {
    hapticLight();
    const latitude = driverLocation?.lat ?? region.latitude;
    const longitude = driverLocation?.lng ?? region.longitude;
    setRegion((prev) => ({ ...prev, latitude, longitude, latitudeDelta: 0.035, longitudeDelta: 0.035 }));
    cameraRef.current?.setCamera({
      centerCoordinate: [Number(longitude), Number(latitude)],
      zoomLevel: 16,
      animationMode: "flyTo",
      animationDuration: 650,
    });
  }, [driverLocation?.lat, driverLocation?.lng, region.latitude, region.longitude]);

  const resetMapBearing = useCallback(() => {
    hapticLight();
    (cameraRef.current as any)?.setCamera({ heading: 0, animationMode: "easeTo", animationDuration: 450 });
  }, []);

  const centerOnNearestOpenRequest = useCallback(() => {
    hapticLight();
    const best = areaIntel?.best_hotspot;
    if (best) {
      cameraRef.current?.setCamera({
        centerCoordinate: [best.lng, best.lat],
        zoomLevel: 14.5,
        animationMode: "flyTo",
        animationDuration: 700,
      });
      Animated.spring(sheetOffset, {
        toValue: sheetMaxRef.current,
        damping: 22,
        stiffness: 210,
        mass: 0.75,
        useNativeDriver: true,
      }).start();
      return;
    }

    const withPickup = availableOrders.find(
      (order) =>
        order.pickup_lat != null &&
        (order.pickup_lng != null ||
          (order as any).pickup_lon != null ||
          (order as any).pickup_longitude != null),
    );
    if (!withPickup || withPickup.pickup_lat == null) {
      Alert.alert(
        t("driver.home.busyArea.title", "Busy area"),
        t(
          "driver.home.busyArea.empty",
          "No open nearby requests with a pickup location right now.",
        ),
      );
      return;
    }
    const lng =
      withPickup.pickup_lng ??
      (withPickup as any).pickup_lon ??
      (withPickup as any).pickup_longitude;
    cameraRef.current?.setCamera({
      centerCoordinate: [Number(lng), Number(withPickup.pickup_lat)],
      zoomLevel: 14.5,
      animationMode: "flyTo",
      animationDuration: 700,
    });
    Animated.spring(sheetOffset, {
      toValue: sheetMaxRef.current,
      damping: 22,
      stiffness: 210,
      mass: 0.75,
      useNativeDriver: true,
    }).start();
  }, [areaIntel?.best_hotspot, availableOrders, sheetOffset, t]);

  const viewHotspots = useCallback(() => {
    hapticLight();
    const lat = driverLocation?.lat ?? region.latitude;
    const lng = driverLocation?.lng ?? region.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      Alert.alert(
        t("driver.home.hotspots.title", "Hotspots"),
        t("driver.home.hotspots.needGps", "Enable GPS to view demand hotspots."),
      );
      return;
    }
    navAny.navigate("DriverHotspots" as never, {
      lat,
      lng,
      isOnline,
    } as never);
  }, [driverLocation?.lat, driverLocation?.lng, isOnline, navAny, region.latitude, region.longitude, t]);

  useEffect(() => {
    return () => {
      void stopSound();
    };
  }, [stopSound]);

  const onlineLabel = isOnline ? t("driver.home.online", "ONLINE") : t("driver.home.offline", "OFFLINE");
  const onlineColorBg = isOnline ? GREEN : "#EF4444";
  const fallbackActivity = activityFromNearbyRequests(availableOrders.length);
  const marketAreaLabel =
    driverMarket.scopeResolved && driverMarket.displayLabel
      ? driverMarket.displayLabel
      : zoneName;
  const pointsProgressLabel = (() => {
    const pts = Math.round(driverStats.points);
    const next = getNextDriverLevel(driverStats.points);
    if (next?.minPoints != null) {
      return `${pts.toLocaleString()} / ${next.minPoints.toLocaleString()} pts`;
    }
    return `${pts.toLocaleString()} pts`;
  })();
  const nextRewardLabel = nextMarketingReward
    ? nextMarketingReward.rewardLabel
    : driverStats.nextLevel
      ? driverStats.nextLevel
      : driverStats.level;
  const liveWaitLabel =
    areaIntel?.wait_label && areaIntel.wait_label !== "—"
      ? areaIntel.wait_label
      : waitRangeText;
  const liveDemandLabel = areaIntel?.demand_label ?? fallbackActivity.label;
  const liveDemandDetail = areaIntel
    ? `${areaIntel.earnings_multiplier.toFixed(1)}x · ${areaIntel.requests_nearby} open`
    : fallbackActivity.detail;
  const liveDriversNearby = areaIntel?.drivers_nearby ?? 0;
  const liveRequestsNearby =
    areaIntel?.requests_nearby ?? availableOrders.length;
  const offerPickupLng =
    activeOffer?.pickup_lng ??
    (activeOffer as any)?.pickup_lon ??
    (activeOffer as any)?.pickup_long ??
    (activeOffer as any)?.pickup_longitude ??
    null;
  const offerDropoffLng =
    activeOffer?.dropoff_lng ??
    (activeOffer as any)?.dropoff_lon ??
    (activeOffer as any)?.dropoff_long ??
    (activeOffer as any)?.dropoff_longitude ??
    null;
  const hasOfferPickup = activeOffer?.pickup_lat != null && offerPickupLng != null;
  const hasOfferDropoff = activeOffer?.dropoff_lat != null && offerDropoffLng != null;

  const searchPulseScale = searchingAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.02, 1] });
  const radarInnerScale = searchingAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.08, 1] });
  const topHudTranslateY = topHudAnim.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] });
  /** Incoming taxi offers or an in-progress taxi ride replace the browse sheet (not idle Taxi mode). */
  const taxiSurfaceActive =
    hasTaxiActiveOffers || Boolean(activeTaxiRide?.id);

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.root}>
        <Mapbox.MapView
          style={styles.map}
          styleURL={mapStyleUrl}
          logoEnabled
          attributionEnabled={false}
          compassEnabled={false}
          surfaceView={false}
        >
          {/* Location updates only — native blue puck fully disabled */}
          <Mapbox.UserLocation visible={false} />
          <Mapbox.Camera
            ref={cameraRef}
            zoomLevel={13}
            centerCoordinate={[Number(region.longitude), Number(region.latitude)]}
            animationMode="flyTo"
            animationDuration={800}
          />

          {hasLocation ? (
            <Mapbox.MarkerView
              id="driver-location-aurora"
              coordinate={[Number(region.longitude), Number(region.latitude)]}
              anchor={{ x: 0.5, y: 0.5 }}
              allowOverlap
              allowOverlapWithPuck
            >
              <MmdDriverLocationMarker
                headingDeg={driverHeadingDeg}
                moving={driverMoving}
                online={isOnline}
              />
            </Mapbox.MarkerView>
          ) : null}

          {activeOffer && hasOfferPickup && (
            <Mapbox.PointAnnotation id="pickup-location" coordinate={[offerPickupLng as number, activeOffer.pickup_lat as number]}>
              <View style={styles.pickupPin}><Text style={styles.pinText}>PICKUP</Text></View>
            </Mapbox.PointAnnotation>
          )}

          {activeOffer && hasOfferDropoff && (
            <Mapbox.PointAnnotation id="dropoff-location" coordinate={[offerDropoffLng as number, activeOffer.dropoff_lat as number]}>
              <View style={styles.dropoffPin}><Text style={styles.pinText}>DROPOFF</Text></View>
            </Mapbox.PointAnnotation>
          )}

          {isOnline && areaIntel?.hotspots?.length ? (
            <Mapbox.ShapeSource
              id="home-hotspots"
              shape={{
                type: "FeatureCollection",
                features: areaIntel.hotspots.slice(0, 8).map((h) => ({
                  type: "Feature" as const,
                  id: h.id,
                  properties: {
                    multiplier: h.multiplier,
                    radiusOuter: Math.min(42, 18 + h.request_count * 4),
                    radiusInner: Math.min(22, 8 + h.request_count * 2),
                    color:
                      h.demand_level === "very_busy"
                        ? "#EF4444"
                        : h.demand_level === "busy"
                          ? "#F97316"
                          : h.demand_level === "moderate"
                            ? "#EAB308"
                            : "#22C55E",
                  },
                  geometry: {
                    type: "Point" as const,
                    coordinates: [h.lng, h.lat],
                  },
                })),
              }}
            >
              <Mapbox.CircleLayer
                id="home-hotspot-glow"
                style={{
                  circleRadius: ["get", "radiusOuter"],
                  circleColor: ["get", "color"],
                  circleOpacity: 0.14,
                  circleBlur: 0.85,
                }}
              />
              <Mapbox.CircleLayer
                id="home-hotspot-circles"
                style={{
                  circleRadius: ["get", "radiusInner"],
                  circleColor: ["get", "color"],
                  circleOpacity: 0.32,
                  circleBlur: 0.35,
                }}
              />
              <Mapbox.SymbolLayer
                id="home-hotspot-labels"
                style={{
                  textField: ["concat", ["to-string", ["get", "multiplier"]], "x"],
                  textSize: 11,
                  textColor: "#0F172A",
                  textHaloColor: "#FFFFFF",
                  textHaloWidth: 1.2,
                  textAllowOverlap: true,
                }}
              />
            </Mapbox.ShapeSource>
          ) : null}
        </Mapbox.MapView>

        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.topHud,
            {
              // Flush under status bar — compact mockup header.
              paddingTop: insets.top + 4,
              opacity: topHudAnim,
              transform: [{ translateY: topHudTranslateY }],
            },
          ]}
        >
          <View style={styles.topBar}>
            <IconButton icon="menu" onPress={openDriverMenu} />
            <View style={styles.locationSlot}>
              {driverMarket.scopeResolved ? (
                <MarketScopePill market={driverMarket} variant="light" />
              ) : (
                <View style={styles.locationFallback}>
                  <Ionicons name="location" size={14} color="#16A34A" />
                  <Text style={styles.locationFallbackText} numberOfLines={1}>
                    {marketAreaLabel}
                  </Text>
                  <Ionicons name="chevron-down" size={12} color="#9CA3AF" />
                </View>
              )}
            </View>
            <TouchableOpacity
              onPress={toggleOnline}
              activeOpacity={0.9}
              style={[
                styles.onlinePill,
                isOnline ? styles.onlinePillOn : styles.onlinePillOff,
              ]}
            >
              <View
                style={[
                  styles.onlineDot,
                  { backgroundColor: isOnline ? "#22C55E" : "#9CA3AF" },
                ]}
              />
              <Text style={[styles.onlineText, isOnline ? styles.onlineTextOn : null]}>
                {onlineLabel}
              </Text>
              <Text style={[styles.onlineArrow, isOnline ? styles.onlineArrowOn : null]}>
                ⌄
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={openDriverInbox}
              activeOpacity={0.85}
              style={styles.iconButton}
            >
              <AppIcon name="bell" />
              {availableOrders.length > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{availableOrders.length}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
          <View style={styles.modesWrap}>
            <DriverHomeServiceModes
              preferences={servicePreferences}
              onPressMode={openDriverServices}
            />
          </View>
        </Animated.View>

        {isOnline ? (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={viewHotspots}
            style={[styles.demandPill, { top: insets.top + 98 }]}
          >
            <Ionicons name="flame" size={12} color="#EA580C" />
            <Text style={styles.demandPillText}>Demand</Text>
            <Ionicons name="chevron-down" size={11} color="#64748B" />
          </TouchableOpacity>
        ) : null}

        <View
          pointerEvents="box-none"
          style={[styles.mapFabColumn, { top: insets.top + 98 }]}
        >
          {hasLocation ? (
            <MapFloatingButton
              icon="locate"
              onPress={centerOnDriver}
              accessibilityLabel={t("driver.home.map.recenter", "Recentrer sur ma position")}
              scheme="day"
              compact
            />
          ) : (
            <MapFloatingButton
              icon="compass"
              onPress={resetMapBearing}
              accessibilityLabel={t("driver.home.map.compass", "Réorienter vers le nord")}
              scheme="day"
              compact
            />
          )}
          <MapFloatingButton
            icon="layers"
            onPress={() =>
              setMapStyleUrl((prev) =>
                prev.includes("streets-v12")
                  ? "mapbox://styles/mapbox/light-v11"
                  : "mapbox://styles/mapbox/streets-v12",
              )
            }
            accessibilityLabel={t("driver.home.map.layers", "Map layers")}
            scheme="day"
            compact
            state={mapStyleUrl.includes("light-v11") ? "active" : "default"}
            style={{ marginTop: 8 }}
          />
          <MapFloatingButton
            icon="shield"
            onPress={() => navigation.navigate("DriverHelp")}
            accessibilityLabel={t("driver.home.map.safety", "Safety")}
            scheme="day"
            compact
            style={{ marginTop: 8 }}
          />
        </View>

        {gpsLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color="#0F172A" />
            <Text style={[styles.loadingText, { color: "#0F172A" }]}>
              {t("driver.home.gps.locating", "Localisation du chauffeur…")}
            </Text>
          </View>
        )}

        <View pointerEvents="box-none" style={styles.bottomArea}>
          {/* Incoming accept cards stay as temporary overlays (same pattern as Uber request cards). */}
          {activeOffer ? (
            <OfferCard
              offer={activeOffer}
              countdown={countdown}
              accepting={acceptingId === getOrderCompositeKey(activeOffer)}
              formatKind={formatKind}
              formatDate={formatDate}
              onDecline={handleDeclineActiveOffer}
              onAccept={() => handleAccept(activeOffer)}
              t={t}
            />
          ) : null}

          {!activeOffer && !taxiSurfaceActive ? (
            <Animated.View
              style={[styles.sheetHost, { transform: [{ translateY: sheetOffset }] }]}
              {...panResponder.panHandlers}
            >
              <DriverHomePremiumSheet
                isOnline={isOnline}
                searchingSubtitle={searchMessages[searchMessageIndex]}
                smartDispatch={
                  areaIntel?.smart_dispatch ?? {
                    status: isOnline ? "quiet" : "offline",
                    recommendation: searchMessages[searchMessageIndex],
                    chips: [],
                  }
                }
                zone={{
                  areaLabel: marketAreaLabel,
                  activityLabel: isOnline
                    ? liveDemandLabel
                    : t("driver.home.offline", "OFFLINE"),
                  activityDetail: isOnline ? liveDemandDetail : waitSubText,
                  driversNearby: liveDriversNearby,
                  driversDetail: areaIntel?.area.radius_miles != null
                    ? t("driver.home.driversWithin", "within {{miles}} mi", {
                        miles: areaIntel.area.radius_miles,
                      })
                    : t("driver.home.driversNearbyDetail", "in your area"),
                  requestsNearby: liveRequestsNearby,
                  waitRangeLabel: liveWaitLabel,
                  waitDetail: waitTitleText,
                  earningsMultiplier: areaIntel?.earnings_multiplier ?? null,
                }}
                stats={{
                  todayEarningsLabel: money(todayEarnings),
                  tripsToday: driverStats.completedTripsToday,
                  points: driverStats.points,
                  level: driverStats.level,
                  nextLevel: driverStats.nextLevel,
                  levelProgress: driverStats.levelProgress,
                  pointsProgressLabel: nextMarketingReward
                    ? `${nextMarketingReward.progressLabel}`
                    : pointsProgressLabel,
                  nextRewardLabel,
                }}
                earningsHidden={earningsHidden}
                onToggleEarningsHidden={() => {
                  hapticLight();
                  setEarningsHidden((value) => !value);
                }}
                onOpenEarnings={() => {
                  hapticLight();
                  if (nextMarketingReward) {
                    navAny.navigate("DriverOpportunities" as never);
                    return;
                  }
                  navAny.navigate("DriverRevenueTab" as never);
                }}
                onViewHotspots={viewHotspots}
                onViewAllJobs={() => {
                  hapticLight();
                  Animated.spring(sheetOffset, {
                    toValue: SHEET_MIN_TRANSLATE_Y,
                    useNativeDriver: true,
                    bounciness: 0,
                    speed: 18,
                  }).start();
                }}
                onGoBusyArea={centerOnNearestOpenRequest}
                onGoOffline={() => {
                  if (isOnline) void toggleOnline();
                }}
                onGoOnline={() => {
                  if (!isOnline) void toggleOnline();
                }}
                onForceOnlinePreview={
                  __DEV__
                    ? () => {
                        console.warn("[DEV] Forcing Driver Home ONLINE UI preview");
                        forceOnlinePreviewRef.current = true;
                        setIsOnline(true);
                      }
                    : undefined
                }
                onRefreshJobs={() => {
                  hapticLight();
                  void fetchDriverOrders(true);
                  void refreshActiveTaxiRide();
                  void refreshAreaIntelligence();
                }}
                jobs={premiumJobs}
                jobsLoading={loading}
                jobsError={error}
                searchPulseStyle={{ transform: [{ scale: searchPulseScale }] }}
                radarPulseStyle={{ transform: [{ scale: radarInnerScale }] }}
                bottomPadding={DRIVER_BOTTOM_PANEL_OFFSET}
              />
            </Animated.View>
          ) : null}

          {/* Taxi offer / active-ride overlay only — no idle "Taxi mode" card. */}
          {!activeOffer ? (
            <View
              pointerEvents="box-none"
              style={taxiSurfaceActive ? styles.offerWrap : styles.taxiPanelHost}
            >
              <DriverTaxiPanel
                isOnline={isOnline}
                elevated={taxiSurfaceActive}
                onActiveOffersChange={setHasTaxiActiveOffers}
              />
            </View>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

function IconButton({ icon, onPress }: { icon: IconName; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.iconButton}>
      <AppIcon name={icon} />
    </TouchableOpacity>
  );
}

type IconName = "menu" | "bell" | "locate" | "medal" | "star";

function AppIcon({ name }: { name: IconName }) {
  if (name === "menu") {
    return (
      <View style={styles.menuIcon}>
        <View style={styles.menuLine} />
        <View style={styles.menuLine} />
        <View style={styles.menuLineShort} />
      </View>
    );
  }

  if (name === "bell") {
    return (
      <View style={styles.bellIcon}>
        <View style={styles.bellTop} />
        <View style={styles.bellBody} />
        <View style={styles.bellClapper} />
      </View>
    );
  }

  if (name === "locate") {
    return (
      <View style={styles.locateIcon}>
        <View style={styles.locateNeedle} />
      </View>
    );
  }

  if (name === "medal") {
    return (
      <View style={styles.medalIcon}>
        <View style={styles.medalRibbonLeft} />
        <View style={styles.medalRibbonRight} />
        <View style={styles.medalCircle} />
      </View>
    );
  }

  return (
    <View style={styles.starIcon}>
      <Text style={styles.starGlyph}>★</Text>
    </View>
  );
}

function Chip({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}> 
      <Text style={[styles.chipText, { color }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function GoalCard({ icon, title, sub, progress }: { icon: IconName; title: string; sub: string; progress: number }) {
  return (
    <View style={styles.goalCard}>
      <AppIcon name={icon} />
      <Text style={styles.goalTitle} numberOfLines={1}>{title}</Text>
      <Text style={styles.goalSub} numberOfLines={1}>{sub}</Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(1, progress)) * 100}%` }]} />
      </View>
    </View>
  );
}

function OrderRow({
  order,
  onPress,
  formatStatus,
  formatKind,
  formatDate,
}: {
  order: DriverOrder;
  onPress: () => void;
  formatStatus: (status: OrderStatus) => string;
  formatKind: (kind: OrderKind, restaurantName: string | null) => string;
  formatDate: (iso: string | null) => string;
}) {
  const amount = getBestDriverAmount(order);
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.86} style={styles.orderRow}>
      <View style={styles.orderTop}>
        <View>
          <Text style={styles.orderId}>#{order.id.slice(0, 8)}</Text>
          <Text style={styles.orderKind}>{formatKind(order.kind, order.restaurant_name)}</Text>
          <Text style={styles.orderTime}>{formatDate(order.created_at)}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={styles.orderStatus}>{formatStatus(order.status)}</Text>
          <Text style={styles.orderAmount}>{money(amount)}</Text>
        </View>
      </View>
      <View style={styles.orderDetailsRow}>
        <View style={styles.detailBlock}>
          <Text style={styles.detailLabel}>Pickup</Text>
          <Text style={styles.detailValue} numberOfLines={1}>{order.pickup_address ?? "—"}</Text>
        </View>
        <View style={styles.detailBlock}>
          <Text style={styles.detailLabel}>Dropoff</Text>
          <Text style={styles.detailValue} numberOfLines={1}>{order.dropoff_address ?? "—"}</Text>
        </View>
        <View style={styles.detailBlockSmall}>
          <Text style={styles.detailLabel}>Miles</Text>
          <Text style={styles.detailValue}>{order.distance_miles != null ? order.distance_miles.toFixed(1) : "—"}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function OfferCard({
  offer,
  countdown,
  accepting,
  formatKind,
  formatDate,
  onDecline,
  onAccept,
  t,
}: {
  offer: DriverOrder;
  countdown: number;
  accepting: boolean;
  formatKind: (kind: OrderKind, restaurantName: string | null) => string;
  formatDate: (iso: string | null) => string;
  onDecline: () => void;
  onAccept: () => void;
  t: any;
}) {
  const amount = getBestDriverAmount(offer);
  return (
    <View style={styles.offerWrap}>
      <View style={styles.offerCard}>
        <View style={styles.offerHeader}>
          <Text style={styles.offerTitle}>{t("driver.home.offer.title", "New delivery available")}</Text>
          <Text style={styles.countdown}>{countdown}s</Text>
        </View>
        <Text style={styles.orderKind}>{formatKind(offer.kind, offer.restaurant_name)}</Text>
        <Text style={styles.offerAddress}>Pickup: <Text style={styles.offerAddressStrong}>{offer.pickup_address ?? "—"}</Text></Text>
        <Text style={styles.offerAddress}>Dropoff: <Text style={styles.offerAddressStrong}>{offer.dropoff_address ?? "—"}</Text></Text>
        <View style={styles.offerStats}>
          <Text style={styles.offerStat}>Distance: <Text style={styles.offerStatStrong}>{offer.distance_miles != null ? `${offer.distance_miles.toFixed(2)} mi` : "—"}</Text></Text>
          <Text style={styles.offerMoney}>{money(amount)}</Text>
        </View>
        <Text style={styles.orderTime}>{formatDate(offer.created_at)}</Text>
        <View style={styles.offerActions}>
          <TouchableOpacity onPress={onDecline} style={styles.declineButton}><Text style={styles.actionText}>Ignore</Text></TouchableOpacity>
          <TouchableOpacity onPress={onAccept} disabled={accepting} style={[styles.acceptButton, accepting && { opacity: 0.6 }]}>
            <Text style={styles.acceptText}>{accepting ? "Accepting..." : "Accept"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#E8EEF5" },
  root: { flex: 1, backgroundColor: "#E8EEF5" },
  map: { flex: 1 },
  topHud: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 40,
  },
  sheetHost: {
    width: "100%",
  },
  topBar: {
    marginHorizontal: 10,
    height: 32,
    zIndex: 100,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  locationSlot: {
    flex: 1,
    minWidth: 0,
    alignItems: "stretch",
  },
  locationFallback: {
    minHeight: 32,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  locationFallbackText: {
    color: "#0F172A",
    fontSize: 12,
    fontWeight: "700",
    flexShrink: 1,
  },
  iconButton: {
    height: 32,
    width: 32,
    borderRadius: 16,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: { color: "#0F172A", fontSize: 24, fontWeight: "900" },
  menuIcon: { width: 20, height: 14, justifyContent: "space-between" },
  menuLine: { height: 2, borderRadius: 999, backgroundColor: "#0F172A", width: 20 },
  menuLineShort: { height: 2, borderRadius: 999, backgroundColor: "#0F172A", width: 14 },
  bellIcon: { width: 22, height: 22, alignItems: "center", justifyContent: "center" },
  bellTop: { width: 6, height: 6, borderRadius: 3, backgroundColor: "transparent", borderWidth: 1.8, borderColor: "#0F172A", marginBottom: -2 },
  bellBody: { width: 16, height: 13, borderTopLeftRadius: 9, borderTopRightRadius: 9, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, borderWidth: 1.8, borderColor: "#0F172A" },
  bellClapper: { width: 5, height: 2.5, borderRadius: 2, backgroundColor: "#0F172A", marginTop: 1 },
  locateIcon: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  locateNeedle: { width: 0, height: 0, borderLeftWidth: 8, borderRightWidth: 8, borderBottomWidth: 20, borderLeftColor: "transparent", borderRightColor: "transparent", borderBottomColor: "#020617", transform: [{ rotate: "45deg" }] },
  medalIcon: { width: 30, height: 32, alignItems: "center", justifyContent: "center" },
  medalRibbonLeft: { position: "absolute", top: 1, left: 7, width: 8, height: 16, borderRadius: 4, backgroundColor: "rgba(167,139,250,0.42)", transform: [{ rotate: "-18deg" }] },
  medalRibbonRight: { position: "absolute", top: 1, right: 7, width: 8, height: 16, borderRadius: 4, backgroundColor: "rgba(167,139,250,0.28)", transform: [{ rotate: "18deg" }] },
  medalCircle: { position: "absolute", bottom: 2, width: 22, height: 22, borderRadius: 11, borderWidth: 3, borderColor: "#C4B5FD", backgroundColor: "rgba(139,92,246,0.16)" },
  starIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(139,92,246,0.14)" },
  starGlyph: { color: "#C4B5FD", fontSize: 22, fontWeight: "900", marginTop: -2 },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
  onlinePill: {
    minWidth: 96,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    paddingHorizontal: 10,
  },
  onlinePillOn: {
    backgroundColor: "#0B1220",
  },
  onlinePillOff: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 6,
  },
  onlineText: { color: "#374151", fontSize: 11, fontWeight: "900", letterSpacing: 0.3 },
  onlineTextOn: { color: "#FFFFFF" },
  onlineArrow: { color: "#9CA3AF", fontSize: 11, fontWeight: "900", marginLeft: 4, marginTop: -1 },
  onlineArrowOn: { color: "#CBD5E1" },
  modesWrap: {
    marginTop: 8,
    marginBottom: 0,
  },
  mapFabColumn: {
    position: "absolute",
    right: 12,
    zIndex: 50,
    alignItems: "center",
  },
  demandPill: {
    position: "absolute",
    left: 12,
    zIndex: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingHorizontal: 10,
    paddingVertical: 7,
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  demandPillText: {
    color: "#0F172A",
    fontSize: 11,
    fontWeight: "700",
  },
  earningsMiniCard: {
    position: "absolute",
    top: 86,
    left: 16,
    width: 190,
    borderRadius: 22,
    padding: 14,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    zIndex: 80,
  },
  mutedSmall: { color: "#CBD5E1", fontSize: 12, fontWeight: "600" },
  earningsAmount: { color: "#A78BFA", fontSize: 24, fontWeight: "900", marginTop: 4 },
  linkText: { color: "#C4B5FD", fontSize: 13, fontWeight: "800", marginTop: 6 },
  compassButton: {
    position: "absolute",
    right: 18,
    top: 82,
    height: 46,
    width: 46,
    borderRadius: 23,
    backgroundColor: "rgba(2,6,23,0.9)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: CARD_BORDER,
    zIndex: 80,
  },
  compassN: { color: "#FFFFFF", fontSize: 18, fontWeight: "900" },
  compassArrow: { color: "#93C5FD", fontSize: 12, fontWeight: "900", marginTop: -4 },
  centerButton: {
    position: "absolute",
    right: 18,
    bottom: 355,
    height: 54,
    width: 54,
    borderRadius: 27,
    backgroundColor: "rgba(255,255,255,0.95)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 80,
  },
  centerArrow: { color: "#020617", fontSize: 27, fontWeight: "900", transform: [{ rotate: "-45deg" }] },
  demandFloatingBadge: {
    position: "absolute",
    left: 18,
    top: 146,
    minHeight: 48,
    maxWidth: 218,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: "rgba(2,6,23,0.88)",
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.18)",
    flexDirection: "row",
    alignItems: "center",
    shadowColor: PURPLE,
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
    zIndex: 72,
  },
  demandFloatingIcon: { color: "#C4B5FD", fontSize: 16, fontWeight: "900", marginRight: 10 },
  demandFloatingTitle: { color: "#F8FAFC", fontSize: 13, fontWeight: "900" },
  demandFloatingSub: { color: "#94A3B8", fontSize: 11, fontWeight: "800", marginTop: 2 },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,23,42,0.45)",
    zIndex: 70,
  },
  loadingText: { color: "#E5E7EB", marginTop: 8 },
  pickupPin: { backgroundColor: "#F97316", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 2, borderColor: "white" },
  dropoffPin: { backgroundColor: "#3B82F6", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 2, borderColor: "white" },
  pinText: { color: "white", fontWeight: "800", fontSize: 11 },
  smartModeWrap: { position: "absolute", left: 16, right: 16, bottom: 420, zIndex: 70 },
  smartCard: {
    borderRadius: 24,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(15,23,42,0.92)",
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.24)",
  },
  sheetSmartCard: {
    marginBottom: 12,
  },
  sheetEarningsRow: {
    borderRadius: 20,
    padding: 14,
    marginBottom: 12,
    backgroundColor: "rgba(15,23,42,0.78)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.14)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetEarningsLabel: { color: "#CBD5E1", fontSize: 12, fontWeight: "800" },
  sheetEarningsSub: { color: "#64748B", fontSize: 11, fontWeight: "700", marginTop: 4 },
  sheetEarningsRight: { alignItems: "flex-end" },
  sheetEarningsAmount: { color: "#A78BFA", fontSize: 20, fontWeight: "900" },
  sheetEarningsLink: { color: "#C4B5FD", fontSize: 12, fontWeight: "900", marginTop: 3 },
  earningsEyeButton: {
    marginLeft: 8,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(2,6,23,0.72)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.16)",
  },
  earningsEyeText: { fontSize: 15 },
  sheetStatusRow: {
    minHeight: 34,
    borderRadius: 999,
    marginBottom: 12,
    paddingHorizontal: 12,
    backgroundColor: "rgba(15,23,42,0.68)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.12)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetStatusLeft: { flexDirection: "row", alignItems: "center", flexShrink: 0 },
  sheetStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  sheetStatusText: { color: "#F8FAFC", fontSize: 12, fontWeight: "900", letterSpacing: 0.3 },
  sheetStatusZone: { color: "#94A3B8", fontSize: 12, fontWeight: "800", maxWidth: 170 },
  logoBox: {
    width: 56,
    height: 56,
    borderRadius: 18,
    marginRight: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,140,0,0.45)",
    backgroundColor: "#0B0F1A",
  },
  logo: { width: "100%", height: "100%" },
  smartTextWrap: { flex: 1 },
  rowCenter: { flexDirection: "row", alignItems: "center" },
  smartTitle: { color: "#F8FAFC", fontSize: 17, fontWeight: "900" },
  smartSubtitle: { color: "#CBD5E1", fontSize: 12.5, fontWeight: "600", marginTop: 4 },
  livePill: { marginLeft: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: "rgba(139,92,246,0.16)", borderWidth: 1, borderColor: "rgba(167,139,250,0.36)" },
  liveText: { color: "#C4B5FD", fontSize: 10, fontWeight: "900" },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 9 },
  chip: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, marginRight: 6, marginBottom: 6 },
  chipText: { fontSize: 10, fontWeight: "800", maxWidth: 120 },
  bottomArea: { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 100 },
  taxiPanelHost: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 70,
  },
  sheet: {
    width: "100%",
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: DRIVER_BOTTOM_PANEL_OFFSET,
    backgroundColor: "rgba(2,6,23,0.985)",
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: "rgba(139,92,246,0.22)",
    shadowColor: "#000",
    shadowOpacity: 0.32,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -10 },
    elevation: 22,
  },
  handle: { alignSelf: "center", width: 46, height: 5, borderRadius: 999, backgroundColor: "rgba(203,213,225,0.48)", marginBottom: 10 },
  waitCard: { borderRadius: 24, padding: 16, backgroundColor: "rgba(15,23,42,0.88)", borderWidth: 1, borderColor: "rgba(139,92,246,0.16)", flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  waitMain: { color: "#A78BFA", fontSize: 22, fontWeight: "900" },
  waitTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "800", marginTop: 2 },
  waitSub: { color: "#94A3B8", fontSize: 12, marginTop: 6 },
  clockCircle: { width: 54, height: 54, borderRadius: 27, backgroundColor: "rgba(15,23,42,0.85)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: CARD_BORDER },
  clockText: { color: "#94A3B8", fontSize: 28 },
  goalsRow: { flexDirection: "row", marginTop: 12 },
  goalCard: { flex: 1, borderRadius: 20, padding: 12, backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER, marginRight: 8 },
  goalIcon: { color: "#DDD6FE", fontSize: 24, fontWeight: "900" },
  goalTitle: { color: "#FFFFFF", fontSize: 13, fontWeight: "900", marginTop: 8 },
  goalSub: { color: "#94A3B8", fontSize: 11, marginTop: 4 },
  progressTrack: { height: 6, borderRadius: 999, backgroundColor: "rgba(148,163,184,0.22)", marginTop: 10, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 999, backgroundColor: PURPLE },
  ordersPanel: { marginTop: 12, borderRadius: 22, padding: 12, backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER },
  panelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  panelTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "900" },
  refreshText: { color: "#A78BFA", fontSize: 13, fontWeight: "800" },
  errorText: { color: "#FCA5A5", fontSize: 12, marginBottom: 6 },
  ordersScroll: { maxHeight: 150 },
  emptyBox: { paddingVertical: 14, alignItems: "center" },
  emptyTitle: { color: "#CBD5E1", fontSize: 13, fontWeight: "700" },
  emptySub: { color: "#64748B", fontSize: 11, marginTop: 3 },
  orderRow: { backgroundColor: "rgba(2,6,23,0.88)", borderRadius: 16, borderWidth: 1, borderColor: "rgba(148,163,184,0.12)", padding: 12, marginBottom: 8 },
  orderTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  orderId: { color: "#F8FAFC", fontSize: 15, fontWeight: "900" },
  orderKind: { color: "#93C5FD", fontSize: 12, marginTop: 3 },
  orderTime: { color: "#64748B", fontSize: 11, marginTop: 3 },
  orderStatus: { color: "#A78BFA", fontSize: 12, fontWeight: "800" },
  orderAmount: { color: "#FFFFFF", fontSize: 20, fontWeight: "900", marginTop: 8 },
  orderDetailsRow: { flexDirection: "row" },
  detailBlock: { flex: 1, marginRight: 8 },
  detailBlockSmall: { width: 48 },
  detailLabel: { color: "#64748B", fontSize: 10, fontWeight: "700" },
  detailValue: { color: "#E2E8F0", fontSize: 11, fontWeight: "700", marginTop: 3 },
  offerWrap: { paddingHorizontal: 16, paddingBottom: DRIVER_BOTTOM_PANEL_OFFSET },
  offerCard: { borderRadius: 24, padding: 16, backgroundColor: "rgba(2,6,23,0.96)", borderWidth: 1, borderColor: "rgba(139,92,246,0.24)" },
  offerHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  offerTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "900" },
  countdown: { color: "#F97316", fontSize: 24, fontWeight: "900" },
  offerAddress: { color: "#94A3B8", fontSize: 12, marginTop: 7 },
  offerAddressStrong: { color: "#E2E8F0", fontWeight: "800" },
  offerStats: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12 },
  offerStat: { color: "#94A3B8", fontSize: 12 },
  offerStatStrong: { color: "#FFFFFF", fontWeight: "900" },
  offerMoney: { color: "#4ADE80", fontSize: 22, fontWeight: "900" },
  offerActions: { flexDirection: "row", marginTop: 14 },
  declineButton: { flex: 1, paddingVertical: 12, borderRadius: 999, backgroundColor: "#EF4444", alignItems: "center", marginRight: 10 },
  acceptButton: { flex: 1, paddingVertical: 12, borderRadius: 999, backgroundColor: GREEN, alignItems: "center" },
  actionText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  acceptText: { color: "#022C22", fontSize: 14, fontWeight: "900" },
});
