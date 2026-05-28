import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from "react";
import {
  SafeAreaView,
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
  Image,
  AppState,
  StyleSheet,
  Vibration,
  type AppStateStatus,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";
import {
  getDriverOnlineStatus,
  setDriverOnlineStatus,
} from "../lib/driverStatus";
import { registerUserPushToken } from "../lib/notifications";

import Mapbox from "@rnmapbox/maps";
import * as Location from "expo-location";
import { Audio } from "expo-av";
import { useTranslation } from "react-i18next";
import { useKeepAwake } from "expo-keep-awake";

Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN || "");

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
  source_table?: "orders" | "delivery_requests";
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

const SHEET_MIN_TRANSLATE_Y = 0;
const SHEET_MID_TRANSLATE_Y = 260;
const SHEET_MAX_TRANSLATE_Y = 520;

// Bottom sheet production tuning:
 // - FULL WIDTH, no side gap, no bottom visual gap.
 // - Starts slightly lower so the map stays visible.
 // - Still snaps fully to the top when dragged upward.
 // Keeps floating driver UI above Android/iOS system navigation and bottom tabs.
// This prevents Home / Earnings / Inbox / Menu from being pushed under the device nav bar,
// especially on Samsung tablets and Android gesture/button navigation.
const DRIVER_BOTTOM_NAV_SAFE_OFFSET = Platform.select({
  android: 48,
  ios: 28,
  default: 38,
});

const DRIVER_BOTTOM_TAB_CLEARANCE = Platform.select({
  android: 92,
  ios: 64,
  default: 78,
});

const DRIVER_BOTTOM_PANEL_OFFSET =
  (DRIVER_BOTTOM_TAB_CLEARANCE ?? 64) + (DRIVER_BOTTOM_NAV_SAFE_OFFSET ?? 28);
const MAX_VISIBLE_ORDER_MILES = 5;
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
  return `${order.source_table ?? "orders"}:${order.id}`;
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

function demandColor(demand: ZoneDemand) {
  if (demand === "very_busy") return ORANGE;
  if (demand === "busy") return PURPLE;
  return BLUE;
}

export function DriverHomeScreen() {
  const navigation = useNavigation<Nav>();
  const navAny = navigation as unknown as AnyNav;
  const { t } = useTranslation();
  useKeepAwake();

  useEffect(() => {
    void registerUserPushToken("driver");
  }, []);

  const [loading, setLoading] = useState(false);
  const [availableOrders, setAvailableOrders] = useState<DriverOrder[]>([]);
  const [myOrders, setMyOrders] = useState<DriverOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [activeOffer, setActiveOffer] = useState<DriverOrder | null>(null);
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
  const [zoneStatus, setZoneStatus] = useState<ZoneDemand>("calm");
  const [zoneName, setZoneName] = useState(t("driver.home.zone.current", "Zone actuelle"));
  const [zoneMultiplier, setZoneMultiplier] = useState(1.0);
  const [searchMessageIndex, setSearchMessageIndex] = useState(0);
  const [earningsHidden, setEarningsHidden] = useState(false);
  const [driverStats, setDriverStats] = useState<DriverPerformanceStats>(EMPTY_DRIVER_PERFORMANCE_STATS);

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
  const soundRef = useRef<Audio.Sound | null>(null);
  const volumeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volumeRampTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gpsDbIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchSeqRef = useRef(0);
  const mountedRef = useRef(true);
  const restoredOnlineStatusRef = useRef(false);
  const lastOfferIdRef = useRef<string | null>(null);
  const locationPermissionRequestRef = useRef<Promise<boolean> | null>(null);
  const locationPermissionDeniedAlertShownRef = useRef(false);
  const searchingAnim = useRef(new Animated.Value(0)).current;
  const sheetOffset = useRef(new Animated.Value(SHEET_MAX_TRANSLATE_Y)).current;
  const sheetStartOffset = useRef(0);
  const topHudAnim = useRef(new Animated.Value(0)).current;
  const onlinePulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(topHudAnim, {
      toValue: 1,
      duration: 420,
      useNativeDriver: true,
    }).start();
  }, [topHudAnim]);

  useEffect(() => {
    if (!isOnline) {
      onlinePulseAnim.setValue(0);
      return;
    }

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(onlinePulseAnim, { toValue: 1, duration: 1050, useNativeDriver: true }),
        Animated.timing(onlinePulseAnim, { toValue: 0, duration: 1050, useNativeDriver: true }),
      ]),
    );

    pulse.start();
    return () => pulse.stop();
  }, [isOnline, onlinePulseAnim]);

  useEffect(() => {
    if (isOnline && !activeOffer) {
      Animated.spring(sheetOffset, {
        toValue: SHEET_MAX_TRANSLATE_Y,
        damping: 20,
        stiffness: 190,
        mass: 0.8,
        useNativeDriver: true,
      }).start();
    }
  }, [activeOffer, isOnline, sheetOffset]);

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
            : SHEET_MAX_TRANSLATE_Y;
      },

      onPanResponderMove: (_, gestureState) => {
        const raw = sheetStartOffset.current + gestureState.dy;
        const clamped = Math.max(
          SHEET_MIN_TRANSLATE_Y,
          Math.min(SHEET_MAX_TRANSLATE_Y, raw),
        );
        sheetOffset.setValue(clamped);
      },

      onPanResponderRelease: (_, gestureState) => {
        const projected = sheetStartOffset.current + gestureState.dy + gestureState.vy * 90;
        const snapPoints = [
          SHEET_MIN_TRANSLATE_Y,
          SHEET_MID_TRANSLATE_Y,
          SHEET_MAX_TRANSLATE_Y,
        ];

        let final = snapPoints.reduce((closest, point) =>
          Math.abs(point - projected) < Math.abs(closest - projected) ? point : closest,
        );

        if (gestureState.vy < -0.75) final = SHEET_MIN_TRANSLATE_Y;
        if (gestureState.vy > 0.75) final = SHEET_MAX_TRANSLATE_Y;

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
    (latitude: number, longitude: number) => {
      if (!mountedRef.current) return;
      const zoneInfo = getZoneInfoFromLocation(latitude, longitude);
      setDriverLocation({ lat: latitude, lng: longitude });
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
      if (volumeIntervalRef.current) {
        clearInterval(volumeIntervalRef.current);
        volumeIntervalRef.current = null;
      }

      if (volumeRampTimeoutRef.current) {
        clearTimeout(volumeRampTimeoutRef.current);
        volumeRampTimeoutRef.current = null;
      }

      if (stopTimeoutRef.current) {
        clearTimeout(stopTimeoutRef.current);
        stopTimeoutRef.current = null;
      }

      if (soundRef.current) {
        const currentSound = soundRef.current;
        soundRef.current = null;

        try {
          currentSound.setOnPlaybackStatusUpdate(null);
        } catch {}

        try {
          await currentSound.stopAsync();
        } catch {}

        try {
          await currentSound.unloadAsync();
        } catch {}
      }
    } catch (e) {
      console.log("stopSound error:", e);
    }
  }, []);

  const getUserIdOrThrow = useCallback(async () => {
    const { data: sessionData, error: sErr } = await supabase.auth.getSession();
    if (sErr) throw sErr;
    const userId = sessionData.session?.user?.id;
    if (!userId) throw new Error(t("driver.home.errors.mustBeLoggedIn", "Tu dois être connecté."));
    return userId;
  }, [t]);

  const setDriverProfileOnline = useCallback(
    async (userId: string, nextOnline: boolean) => {
      const { data, error } = await supabase
        .from("driver_profiles")
        .update({
          is_online: nextOnline,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .select("user_id,is_online")
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        throw new Error(
          nextOnline
            ? "Impossible de confirmer le statut en ligne dans Supabase."
            : "Impossible de confirmer le statut hors ligne dans Supabase.",
        );
      }

      if (Boolean(data.is_online) !== nextOnline) {
        throw new Error(
          nextOnline
            ? "Supabase n’a pas confirmé le passage en ligne."
            : "Supabase n’a pas confirmé le passage hors ligne.",
        );
      }

      return data;
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
    async (driverId: string) => {
      if (!driverId || gpsDbIntervalRef.current) return;
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

      const pushLocationOnce = async () => {
        try {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const lat = loc.coords.latitude;
          const lng = loc.coords.longitude;
          applyDriverCoordinates(lat, lng);
          const { error: upErr } = await supabase.from("driver_locations").upsert(
            { driver_id: driverId, lat, lng, updated_at: new Date().toISOString() },
            { onConflict: "driver_id" },
          );
          if (upErr) console.log("driver_locations upsert error:", upErr);
        } catch (e) {
          console.log("GPS push error:", e);
        }
      };

      await pushLocationOnce();
      gpsDbIntervalRef.current = setInterval(() => void pushLocationOnce(), 5000);
    },
    [applyDriverCoordinates, ensureGpsPermission, t],
  );

  const stopDbGpsTracking = useCallback(async () => {
    if (gpsDbIntervalRef.current) clearInterval(gpsDbIntervalRef.current);
    gpsDbIntervalRef.current = null;
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
            applyDriverCoordinates(pos.coords.latitude, pos.coords.longitude);
          },
        );
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

      const { data: todayOrders, error: todayOrdersError } = await supabase
        .from("orders")
        .select("id, status, updated_at, created_at, driver_delivery_payout")
        .eq("driver_id", driverId)
        .eq("status", "delivered")
        .gte("updated_at", todayStartIso)
        .order("updated_at", { ascending: false })
        .limit(500);

      if (todayOrdersError) throw todayOrdersError;

      const { data: todayRequests, error: todayRequestsError } = await supabase
        .from("delivery_requests")
        .select("id, status, updated_at, created_at, driver_delivery_payout")
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

        // 1) Commandes disponibles depuis orders.
        // orders.kind est un enum : errand | food | pickup_dropoff.
        // On ne met jamais "delivery" ici, car delivery existe dans delivery_requests.
        const { data: available, error: availableError } = await supabase
          .from("orders")
          .select(
            `id, kind, status, created_at,
             restaurant_name, pickup_address, dropoff_address,
             distance_miles, delivery_fee, driver_delivery_payout, total,
             pickup_lat, pickup_lng, dropoff_lat, dropoff_lng`,
          )
          .in("status", ["pending", "ready"])
          .is("driver_id", null)
          .order("created_at", { ascending: false });

        if (availableError) throw availableError;

        // 2) Demandes MMD Delivery disponibles depuis delivery_requests.
        // Ces demandes sont séparées de orders et doivent être chargées séparément.
        const { data: deliveryAvailable, error: deliveryAvailableError } = await supabase
          .from("delivery_requests")
          .select(
            `id,status,payment_status,driver_id,created_at,updated_at,
             pickup_address,dropoff_address,
             pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,
             distance_miles,eta_minutes,delivery_fee,total,currency,
             driver_delivery_payout,platform_fee`
          )
          .in("status", ["pending", "paid_pending", "processing_pending"])
          .eq("payment_status", "paid")
          .is("driver_id", null)
          .order("created_at", { ascending: false });

        if (deliveryAvailableError) throw deliveryAvailableError;

        // 3) Commandes orders déjà assignées au driver.
        const { data: mine, error: mineError } = await supabase
          .from("orders")
          .select(
            `id, kind, status, created_at,
             restaurant_name, pickup_address, dropoff_address,
             distance_miles, delivery_fee, driver_delivery_payout, total,
             pickup_lat, pickup_lng, dropoff_lat, dropoff_lng`,
          )
          .eq("driver_id", driverId)
          .not("status", "in", '("delivered","canceled")')
          .order("created_at", { ascending: false });

        if (mineError) throw mineError;

        // 4) Demandes delivery_requests déjà assignées au driver.
        const { data: myDeliveryRequests, error: myDeliveryRequestsError } = await supabase
          .from("delivery_requests")
          .select(
            `id,status,payment_status,driver_id,created_at,updated_at,
             pickup_address,dropoff_address,
             pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,
             distance_miles,eta_minutes,delivery_fee,total,currency,
             driver_delivery_payout,platform_fee`
          )
          .eq("driver_id", driverId)
          .not("status", "in", '("delivered","canceled")')
          .order("created_at", { ascending: false });

        if (myDeliveryRequestsError) throw myDeliveryRequestsError;
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

        const allAvailable = [...orderAvailable, ...deliveryAvailableList];
        const visibleAvailable = allAvailable.filter((o) => {
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
          let withinFiveMiles = false;

          if (driverLocation && hasPickupCoordinates) {
            const distance = milesBetween(driverLocation.lat, driverLocation.lng, pickupLat, pickupLng);
            withinFiveMiles = distance <= MAX_VISIBLE_ORDER_MILES;
          }

          // Production safety:
          // orders must have pickup coordinates for nearby filtering.
          // delivery_requests without coordinates are still shown so paid customer requests are not hidden.
          if (isDeliveryRequest) {
            return statusVisible && (!driverLocation || !hasPickupCoordinates || withinFiveMiles);
          }

          return statusVisible && hasPickupCoordinates && (!driverLocation || withinFiveMiles);
        });

        const myList = [...myOrderList, ...myDeliveryList];

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
              (o) => o.id === prev.id && (o.source_table ?? "orders") === (prev.source_table ?? "orders"),
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

  useFocusEffect(
    useCallback(() => {
      void fetchDriverPerformance();
      if (isOnline) void fetchDriverOrders(true);
    }, [fetchDriverPerformance, isOnline, fetchDriverOrders]),
  );

  useEffect(() => {
    if (!isOnline) return;
    const channel = supabase
      .channel(`driver-orders-watch-${Date.now()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, () => scheduleDriverOrdersRefresh(250))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, () => scheduleDriverOrdersRefresh(250))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "orders" }, () => scheduleDriverOrdersRefresh(250))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "delivery_requests" }, () => scheduleDriverOrdersRefresh(250))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "delivery_requests" }, () => scheduleDriverOrdersRefresh(250))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "delivery_requests" }, () => scheduleDriverOrdersRefresh(250))
      .subscribe((status) => console.log("DRIVER_HOME_REALTIME_STATUS", status));

    return () => {
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
      refreshDebounceRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [isOnline, scheduleDriverOrdersRefresh]);

  useEffect(() => {
    if (restoredOnlineStatusRef.current) return;
    restoredOnlineStatusRef.current = true;

    let cancelled = false;

    const restoreSavedOnlineStatus = async () => {
      try {
        const savedOnline = await getDriverOnlineStatus();
        if (cancelled || !mountedRef.current) return;

        if (!savedOnline) {
          setIsOnline(false);
          return;
        }

        const userId = await getUserIdOrThrow();
        await setDriverProfileOnline(userId, true);
        await setDriverOnlineStatus(true);

        if (cancelled || !mountedRef.current) return;
        setIsOnline(true);

        await startDbGpsTracking(userId);
        await fetchDriverOrders(true);
      } catch (e) {
        console.log("restoreSavedOnlineStatus error:", e);
        await setDriverOnlineStatus(false).catch(() => {});
        if (!cancelled && mountedRef.current) setIsOnline(false);
      }
    };

    void restoreSavedOnlineStatus();

    return () => {
      cancelled = true;
    };
  }, [fetchDriverOrders, getUserIdOrThrow, setDriverProfileOnline, startDbGpsTracking]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state !== "active") return;

      void (async () => {
        try {
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
            return;
          }

          const userId = await getUserIdOrThrow();
          await setDriverProfileOnline(userId, true);
          await setDriverOnlineStatus(true);

          if (!mountedRef.current) return;
          if (!isOnline) setIsOnline(true);

          await startDbGpsTracking(userId);
          await fetchDriverOrders(true);
        } catch (e) {
          console.log("AppState online restore error:", e);
          await setDriverOnlineStatus(false).catch(() => {});
          if (mountedRef.current) setIsOnline(false);
        }
      })();
    });

    return () => sub.remove();
  }, [
    fetchDriverOrders,
    getUserIdOrThrow,
    isOnline,
    setDriverProfileOnline,
    startDbGpsTracking,
    stopDbGpsTracking,
    stopSound,
  ]);

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

  const handleAccept = useCallback(
    async (offer: DriverOrder) => {
      const orderId = offer.id;
      const offerSourceTable = offer.source_table ?? "orders";
      const offerKey = getOrderCompositeKey(offer);

      try {
        hapticSuccess();
        setAcceptingId(offerKey);

        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        const userId = sessionData.session?.user?.id;
        if (!userId) throw new Error(t("driver.home.errors.mustBeLoggedIn", "Tu dois être connecté."));

        if (offerSourceTable === "delivery_requests") {
          const { data: acceptedDelivery, error: acceptDeliveryError } = await supabase
            .from("delivery_requests")
            .update({
              driver_id: userId,
              status: "dispatched",
              updated_at: new Date().toISOString(),
            })
            .eq("id", orderId)
            .in("status", ["pending", "paid_pending", "processing_pending"])
            .eq("payment_status", "paid")
            .is("driver_id", null)
            .select("id")
            .maybeSingle();

          if (acceptDeliveryError) throw acceptDeliveryError;

          if (!acceptedDelivery) {
            throw new Error(
              t(
                "driver.home.errors.deliveryAlreadyTaken",
                "This delivery request is no longer available. It may already be accepted by another driver.",
              ),
            );
          }
        } else {
          const { error: rpcError } = await supabase.rpc("driver_accept_ready_order", { p_order_id: orderId });
          if (rpcError) throw rpcError;

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
        Alert.alert(t("shared.orderChat.alerts.errorTitle", "Erreur"), e?.message ?? t("driver.home.errors.accept", "Impossible d'accepter la course."));
      } finally {
        setAcceptingId(null);
      }
    },
    [fetchDriverOrders, navAny, stopSound, t],
  );

  const handleDeclineActiveOffer = useCallback(async () => {
    hapticWarning();
    await stopSound();
    setActiveOffer(null);
    setCountdown(60);
    lastOfferIdRef.current = null;
  }, [stopSound]);

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

    if (lastOfferIdRef.current === `${activeOffer.source_table ?? "orders"}:${activeOffer.id}` && soundRef.current) return;

    lastOfferIdRef.current = `${activeOffer.source_table ?? "orders"}:${activeOffer.id}`;

    let cancelled = false;

    (async () => {
      try {
        await stopSound();

        const { sound } = await Audio.Sound.createAsync(
          require("../../assets/sounds/new_order.wav"),
          {
            shouldPlay: false,
            isLooping: true,
            volume: 0.35,
          },
        );

        if (cancelled || !mountedRef.current || lastOfferIdRef.current !== `${activeOffer.source_table ?? "orders"}:${activeOffer.id}`) {
          await sound.unloadAsync().catch(() => {});
          return;
        }

        soundRef.current = sound;

        // Safety fallback: if Android/iOS does not loop the WAV correctly,
        // restart the sound immediately when it finishes.
        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) return;
          if (status.didJustFinish && soundRef.current === sound && activeOffer?.id) {
            sound.replayAsync().catch(() => {});
          }
        });

        await sound.setPositionAsync(0);
        await sound.playAsync();

        // Smooth volume ramp: starts softer, then reaches full volume after 10 seconds.
        volumeRampTimeoutRef.current = setTimeout(() => {
          let volume = 0.35;

          volumeIntervalRef.current = setInterval(async () => {
            if (!soundRef.current) return;

            volume = Math.min(1, volume + 0.1);

            try {
              await soundRef.current.setVolumeAsync(volume);
            } catch (e) {
              console.log("setVolumeAsync error:", e);
            }

            if (volume >= 1 && volumeIntervalRef.current) {
              clearInterval(volumeIntervalRef.current);
              volumeIntervalRef.current = null;
            }
          }, 1000);
        }, 10000);

        // Driver offer duration is 60 seconds. The sound stops only when:
        // accept, decline, offer timeout, app cleanup, or this safety timeout.
        stopTimeoutRef.current = setTimeout(() => {
          void stopSound();
        }, 60000);
      } catch (e) {
        console.log("Sound error:", e);
      }
    })();

    return () => {
      cancelled = true;
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
      const docTypeSet = new Set(
        documents.map((d: any) =>
          String(d?.doc_type ?? d?.type ?? "")
            .trim()
            .toLowerCase(),
        ),
      );

      const hasDoc = (docType: string) => docTypeSet.has(docType.toLowerCase());
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
        if (!driver.vehicle_brand) missing.push("Marque véhicule");
        if (!driver.vehicle_model) missing.push("Modèle véhicule");
        if (!driver.vehicle_year) missing.push("Année véhicule");
        if (!driver.plate_number) missing.push("Plaque");
        if (!driver.license_number) missing.push("Numéro permis");
        if (!driver.license_expiration && !driver.license_expiry) missing.push("Expiration permis");
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

      if (next) {
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
      await stopDbGpsTracking();
      await stopSound();
      setActiveOffer(null);
      setAvailableOrders([]);
      setMyOrders([]);
      setCountdown(60);
      lastOfferIdRef.current = null;
    } catch (e: any) {
      console.log("toggleOnline error:", e);
      Alert.alert(t("shared.orderChat.alerts.errorTitle", "Erreur"), e?.message ?? "Impossible de changer le statut.");
    }
  }, [ensureGpsPermission, fetchDriverOrders, getUserIdOrThrow, isOnline, setDriverProfileOnline, startDbGpsTracking, stopDbGpsTracking, stopSound, t]);

  const openDriverMenu = useCallback(() => {
    hapticLight();
    navAny.navigate("DriverMenuTab" as never);
  }, [navAny]);

  const openDriverInbox = useCallback(() => {
    hapticLight();
    navAny.navigate("DriverInboxTab" as never);
  }, [navAny]);

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

  useEffect(() => {
    return () => {
      void stopDbGpsTracking();
      void stopSound();
    };
  }, [stopDbGpsTracking, stopSound]);

  const onlineLabel = isOnline ? t("driver.home.online", "ONLINE") : t("driver.home.offline", "OFFLINE");
  const onlineColorBg = isOnline ? GREEN : "#EF4444";
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
  const driverPulseScale = onlinePulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const driverPulseOpacity = onlinePulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.62, 0.22] });
  const topHudTranslateY = topHudAnim.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] });
  const currentDemandColor = demandColor(zoneStatus);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.root}>
        <Mapbox.MapView
          style={styles.map}
          styleURL="mapbox://styles/mapbox/streets-v12"
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
          surfaceView={false}
        >
          <Mapbox.UserLocation visible={false} showsUserHeadingIndicator />
          <Mapbox.Camera
            ref={cameraRef}
            zoomLevel={13}
            centerCoordinate={[Number(region.longitude), Number(region.latitude)]}
            animationMode="flyTo"
            animationDuration={800}
          />

          {hasLocation && (
            <Mapbox.PointAnnotation id="driver-location" coordinate={[Number(region.longitude), Number(region.latitude)]}>
              <Animated.View style={[styles.driverHalo, { opacity: driverPulseOpacity, transform: [{ scale: driverPulseScale }] }]}>
                <View style={styles.driverDotOuter}>
                  <View style={styles.driverDot} />
                </View>
              </Animated.View>
            </Mapbox.PointAnnotation>
          )}

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
        </Mapbox.MapView>

        <Animated.View pointerEvents="box-none" style={[styles.topBar, { opacity: topHudAnim, transform: [{ translateY: topHudTranslateY }] }]}>
          <IconButton icon="menu" onPress={openDriverMenu} />
          <TouchableOpacity onPress={toggleOnline} activeOpacity={0.9} style={styles.onlinePill}>
            <View style={[styles.onlineDot, { backgroundColor: onlineColorBg, shadowColor: onlineColorBg }]} />
            <Text style={styles.onlineText}>{onlineLabel}</Text>
            <Text style={styles.onlineArrow}>⌄</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={openDriverInbox} activeOpacity={0.85} style={styles.iconButton}>
            <AppIcon name="bell" />
            {availableOrders.length > 0 && (
              <View style={styles.badge}><Text style={styles.badgeText}>{availableOrders.length}</Text></View>
            )}
          </TouchableOpacity>
        </Animated.View>


        <TouchableOpacity onPress={resetMapBearing} activeOpacity={0.86} style={styles.compassButton}>
          <Text style={styles.compassN}>N</Text>
          <Text style={styles.compassArrow}>▲</Text>
        </TouchableOpacity>

        {hasLocation && (
          <TouchableOpacity onPress={centerOnDriver} activeOpacity={0.86} style={styles.centerButton}>
            <AppIcon name="locate" />
          </TouchableOpacity>
        )}

        {gpsLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color="#ffffff" />
            <Text style={styles.loadingText}>{t("driver.home.gps.locating", "Localisation du chauffeur…")}</Text>
          </View>
        )}


        <View pointerEvents="box-none" style={styles.bottomArea}>
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
          ) : (
            <Animated.View
              style={[styles.sheet, { transform: [{ translateY: sheetOffset }] }]}
              {...panResponder.panHandlers}
            >
              <View style={styles.handle} />
              <View style={styles.sheetStatusRow}>
                <View style={styles.sheetStatusLeft}>
                  <View style={[styles.sheetStatusDot, { backgroundColor: currentDemandColor, shadowColor: currentDemandColor }]} />
                  <Text style={styles.sheetStatusText}>{isOnline ? demandLabel(zoneStatus) : t("driver.home.offline", "OFFLINE")}</Text>
                </View>
                <Text style={styles.sheetStatusZone} numberOfLines={1}>{zoneName}</Text>
              </View>

              {isOnline && (
                <Animated.View style={[styles.smartCard, styles.sheetSmartCard, { transform: [{ scale: searchPulseScale }] }]}>
                  <Animated.View style={[styles.logoBox, { transform: [{ scale: radarInnerScale }] }]}>
                    <Image source={require("../../assets/brand/mmd-logo.png")} style={styles.logo} resizeMode="contain" />
                  </Animated.View>

                  <View style={styles.smartTextWrap}>
                    <View style={styles.rowCenter}>
                      <Text style={styles.smartTitle}>{t("driver.home.smartMode.title", "MMD Smart Mode")}</Text>
                      <View style={styles.livePill}><Text style={styles.liveText}>{t("driver.home.smartMode.live", "LIVE")}</Text></View>
                    </View>

                    <Text style={styles.smartSubtitle}>{searchMessages[searchMessageIndex]}</Text>

                    <View style={styles.chipsRow}>
                      <Chip label={t("driver.home.smartMode.nearby", "Nearby")} color="#93C5FD" bg="rgba(59,130,246,0.13)" />
                      <Chip label={t("driver.home.smartMode.optimized", "Optimized")} color="#86EFAC" bg="rgba(34,197,94,0.13)" />
                      <Chip label={`${zoneMultiplier.toFixed(1)}x ${zoneName}`} color="#C4B5FD" bg="rgba(139,92,246,0.13)" />
                    </View>
                  </View>
                </Animated.View>
              )}

              {isOnline && (
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => {
                    hapticLight();
                    navAny.navigate("DriverRevenueTab" as never);
                  }}
                  style={styles.sheetEarningsRow}
                >
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={styles.sheetEarningsLabel}>{t("driver.home.earnings.today", "Today's earnings")}</Text>
                    <Text style={styles.sheetEarningsSub}>
                      {earningsHidden
                        ? t("driver.home.earnings.hidden", "{{count}} active delivery(s) · hidden", { count: activeRideCount })
                        : t("driver.home.earnings.live", "{{count}} active delivery(s) · live total", { count: activeRideCount })}
                    </Text>
                  </View>

                  <View style={styles.sheetEarningsRight}>
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <Text style={styles.sheetEarningsAmount}>
                        {earningsHidden ? "••••" : money(todayEarnings)}
                      </Text>

                      <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={(e: any) => {
                          e?.stopPropagation?.();
                          hapticLight();
                          setEarningsHidden((value) => !value);
                        }}
                        style={styles.earningsEyeButton}
                      >
                        <Text style={styles.earningsEyeText}>
                          {earningsHidden ? "👁" : "🙈"}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <Text style={styles.sheetEarningsLink}>{t("driver.home.earnings.breakdown", "View")} ›</Text>
                  </View>
                </TouchableOpacity>
              )}

              <View style={styles.waitCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.waitMain}>{waitRangeText}</Text>
                  <Text style={styles.waitTitle}>{waitTitleText}</Text>
                  <Text style={styles.waitSub}>{waitSubText}</Text>
                </View>
                <View style={styles.clockCircle}><Text style={styles.clockText}>◷</Text></View>
              </View>

              <View style={styles.goalsRow}>
                <GoalCard
                  icon="medal"
                  title={
                    driverStats.nextLevel
                      ? `${driverStats.level} → ${driverStats.nextLevel}`
                      : `${driverStats.level} Driver`
                  }
                  sub={`${Math.round(driverStats.points).toLocaleString()} pts · ${driverStats.completedTripsTotal} completed`}
                  progress={driverStats.levelProgress}
                />
                <GoalCard
                  icon="star"
                  title={t("driver.home.goals.earningsGoal", "Earnings Goal")}
                  sub={`${money(driverStats.todayEarnings)} of ${money(driverStats.dailyEarningsGoal)} · ${driverStats.completedTripsToday} today`}
                  progress={driverStats.earningsGoalProgress}
                />
              </View>

              <View style={styles.ordersPanel}>
                <View style={styles.panelHeader}>
                  <Text style={styles.panelTitle}>{t("driver.home.myOrders.title", "My active deliveries")}</Text>
                  <TouchableOpacity onPress={() => {
                    hapticLight();
                    void fetchDriverOrders(true);
                  }}>
                    <Text style={styles.refreshText}>{t("shared.common.refresh", "Refresh")}</Text>
                  </TouchableOpacity>
                </View>
                {loading && <ActivityIndicator color="#FFFFFF" style={{ marginVertical: 8 }} />}
                {error && <Text style={styles.errorText}>{error}</Text>}
                {myOrders.length === 0 && !loading ? (
                  <View style={styles.emptyBox}>
                    <Text style={styles.emptyTitle}>{t("driver.home.myOrders.emptyTitle", "No active delivery yet.")}</Text>
                    <Text style={styles.emptySub}>{t("driver.home.myOrders.emptySubtitle", "Accepted trips will appear here.")}</Text>
                  </View>
                ) : (
                  <FlatList
                    style={styles.ordersScroll}
                    data={myOrders}
                    keyExtractor={(order) => `${order.source_table ?? "orders"}:${order.id}`}
                    renderItem={({ item: order }) => (
                      <OrderRow
                        order={order}
                        onPress={() => handleOpenOrder(order)}
                        formatStatus={formatStatus}
                        formatKind={formatKind}
                        formatDate={formatDate}
                      />
                    )}
                    contentContainerStyle={{ paddingBottom: 10 }}
                    showsVerticalScrollIndicator={false}
                    initialNumToRender={6}
                    maxToRenderPerBatch={8}
                    windowSize={5}
                    removeClippedSubviews
                  />
                )}
              </View>
            </Animated.View>
          )}
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
  safe: { flex: 1, backgroundColor: "#020617" },
  root: { flex: 1, backgroundColor: "#020617" },
  map: { flex: 1 },
  topBar: {
    position: "absolute",
    top: 14,
    left: 16,
    right: 16,
    height: 56,
    zIndex: 100,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconButton: {
    height: 50,
    width: 50,
    borderRadius: 25,
    backgroundColor: "rgba(2,6,23,0.94)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: CARD_BORDER,
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  iconText: { color: "#FFFFFF", fontSize: 24, fontWeight: "900" },
  menuIcon: { width: 22, height: 18, justifyContent: "space-between" },
  menuLine: { height: 2.4, borderRadius: 999, backgroundColor: "#F8FAFC", width: 22 },
  menuLineShort: { height: 2.4, borderRadius: 999, backgroundColor: "#F8FAFC", width: 15 },
  bellIcon: { width: 24, height: 25, alignItems: "center", justifyContent: "center" },
  bellTop: { width: 7, height: 7, borderRadius: 4, backgroundColor: "transparent", borderWidth: 2, borderColor: "#F8FAFC", marginBottom: -2 },
  bellBody: { width: 18, height: 15, borderTopLeftRadius: 10, borderTopRightRadius: 10, borderBottomLeftRadius: 5, borderBottomRightRadius: 5, borderWidth: 2, borderColor: "#F8FAFC" },
  bellClapper: { width: 6, height: 3, borderRadius: 3, backgroundColor: "#F8FAFC", marginTop: 2 },
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
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: PURPLE,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  onlinePill: {
    minWidth: 158,
    height: 50,
    borderRadius: 999,
    backgroundColor: "rgba(2,6,23,0.94)",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.28)",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 7 },
    elevation: 12,
  },
  onlineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
    shadowOpacity: 0.8,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  onlineText: { color: "#FFFFFF", fontSize: 16, fontWeight: "900", letterSpacing: 0.5 },
  onlineArrow: { color: "#A78BFA", fontSize: 18, fontWeight: "900", marginLeft: 10, marginTop: -3 },
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
  driverHalo: {
    height: 82,
    width: 82,
    borderRadius: 41,
    backgroundColor: "rgba(139,92,246,0.22)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.28)",
  },
  driverDotOuter: {
    height: 38,
    width: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: PURPLE,
    shadowOpacity: 0.42,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  driverDot: {
    height: 24,
    width: 24,
    borderRadius: 12,
    backgroundColor: PURPLE,
    borderWidth: 3,
    borderColor: "#FFFFFF",
  },
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
  bottomArea: { position: "absolute", left: 0, right: 0, bottom: DRIVER_BOTTOM_PANEL_OFFSET, zIndex: 60 },
  sheet: {
    width: "100%",
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
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
  offerWrap: { paddingHorizontal: 16, paddingBottom: 18 },
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
