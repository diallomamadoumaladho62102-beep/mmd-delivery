import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Alert,
  Image,
  Animated,
  Easing,
  AppState,
  StyleSheet,
  Platform,
} from "react-native";
import { Audio } from "expo-av";
import * as KeepAwake from "expo-keep-awake";
import Mapbox from "@rnmapbox/maps";
import { supabase } from "../lib/supabase";
import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { useRestaurantPlatformFeatures } from "../hooks/useRestaurantPlatformFeatures";
import {
  ensureMapboxTokenApplied,
  getMapStyleDark,
  getMapStyleStreets,
} from "../lib/mapboxConfig";

const FALLBACK_RESTAURANT_ID = "";
const IS_DEV = typeof __DEV__ !== "undefined" ? __DEV__ : false;
const DEFAULT_RESTAURANT_COORDINATE: [number, number] = [-73.949997, 40.650002];

const MAX_VISIBLE_MAP_ORDERS = 12;
const MAX_NEARBY_DRIVERS = 8;
const RESTAURANT_ONLINE_KEEP_AWAKE_TAG = "mmd-restaurant-online";
const BOTTOM_NAV_SAFE_OFFSET = Platform.OS === "android" ? 74 : 40;
const FLOATING_SIDE_BOTTOM_OFFSET = BOTTOM_NAV_SAFE_OFFSET + 98;
const SIDE_BUTTON_SIZE = 66;
const SIDE_BUTTON_MIN_HEIGHT = 68;
const BOTTOM_BUTTON_MIN_HEIGHT = 72;

type DashboardStats = {
  ordersToday: number;
  revenueToday: number;
  pendingOrders: number;
  currency: string;
};

type RestaurantProfileLite = {
  restaurant_name?: string | null;
  address?: string | null;
  status?: string | null;
  is_accepting_orders?: boolean | null;
  location_lat?: number | string | null;
  location_lng?: number | string | null;
};

type RestaurantMapOrder = {
  id: string;
  kind?: string | null;
  status: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  created_at?: string | null;
  total?: number | null;
};

type NearbyDriver = {
  driver_id: string;
  lat: number | null;
  lng: number | null;
  updated_at?: string | null;
};

type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  weight?: number;
};

function startOfTodayLocalISOString() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return start.toISOString();
}

function formatMoney(value: number, currency = "USD") {
  const safe = Number.isFinite(value) ? value : 0;
  if (currency === "USD") return `$${safe.toFixed(0)}`;
  return `${safe.toFixed(0)} ${currency}`;
}

function coordinateFromLatLng(latValue: unknown, lngValue: unknown): [number, number] | null {
  const lat = Number(latValue);
  const lng = Number(lngValue);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return [lng, lat];
}

function distanceMilesBetweenCoordinates(from: [number, number], to: [number, number]): number {
  const [fromLng, fromLat] = from;
  const [toLng, toLat] = to;
  const earthRadiusMiles = 3958.8;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(toLat - fromLat);
  const dLng = toRad(toLng - fromLng);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(fromLat)) *
      Math.cos(toRad(toLat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildOrderAmount(row: any) {
  const total = Number(row?.total ?? 0);
  if (Number.isFinite(total) && total > 0) return total;

  const subtotal = Number(row?.subtotal ?? 0);
  const tax = Number(row?.tax ?? 0);
  const derived = subtotal + tax;
  return Number.isFinite(derived) ? derived : 0;
}

function isFiniteCoordinate(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    typeof lng === "number" &&
    Number.isFinite(lng)
  );
}

function hasValidLatLng<T extends { lat: number | null; lng: number | null }>(
  value: T
): value is T & { lat: number; lng: number } {
  return isFiniteCoordinate(value.lat, value.lng);
}

function orderCoordinate(order: RestaurantMapOrder): [number, number] | null {
  const rawLat = order.dropoff_lat ?? order.pickup_lat;
  const rawLng = order.dropoff_lng ?? order.pickup_lng;
  return coordinateFromLatLng(rawLat, rawLng);
}

function makePointFeatureCollection(points: MapPoint[]) {
  return {
    type: "FeatureCollection",
    features: points.map((point) => ({
      type: "Feature",
      id: point.id,
      properties: { weight: point.weight ?? 1 },
      geometry: { type: "Point", coordinates: [point.lng, point.lat] },
    })),
  } as any;
}

function makeLineFeatureCollection(lines: Array<{ id: string; coordinates: [number, number][] }>) {
  return {
    type: "FeatureCollection",
    features: lines
      .filter((line) => line.coordinates.length >= 2)
      .map((line) => ({
        type: "Feature",
        id: line.id,
        properties: {},
        geometry: { type: "LineString", coordinates: line.coordinates },
      })),
  } as any;
}

function statusColor(status: string | null | undefined) {
  const normalized = String(status ?? "").trim().toLowerCase();

  if (normalized === "pending") return "#F97316";
  if (normalized === "accepted" || normalized === "prepared") return "#2563EB";
  if (normalized === "ready") return "#22C55E";
  if (normalized === "urgent") return "#EF4444";
  return "#A78BFA";
}

function statusLabel(status: string | null | undefined) {
  const normalized = String(status ?? "").trim().toLowerCase();

  if (normalized === "pending") return "Pending";
  if (normalized === "accepted") return "Accepted";
  if (normalized === "prepared") return "Preparing";
  if (normalized === "ready") return "Ready";
  return "Order";
}

function FloatingBadge({
  value,
  bg = "#EF4444",
}: {
  value: number | string;
  bg?: string;
}) {
  return (
    <View
      style={{
        position: "absolute",
        top: -7,
        right: -7,
        minWidth: 21,
        height: 21,
        borderRadius: 11,
        paddingHorizontal: 5,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 2,
        borderColor: "#020617",
        zIndex: 5,
      }}
    >
      <Text style={{ color: "white", fontSize: 11, fontWeight: "900" }}>{value}</Text>
    </View>
  );
}

function MapActionButton({
  icon,
  label,
  onPress,
  badge,
  badgeColor,
  active = false,
}: {
  icon: string;
  label?: string;
  onPress: () => void;
  badge?: number | string;
  badgeColor?: string;
  active?: boolean;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.86}
      onPress={onPress}
      style={{
        width: SIDE_BUTTON_SIZE,
        minHeight: label ? SIDE_BUTTON_MIN_HEIGHT : 58,
        borderRadius: 28,
        backgroundColor: active ? "rgba(15,23,42,0.98)" : "rgba(2,6,23,0.92)",
        borderWidth: 1.4,
        borderColor: active ? "rgba(96,165,250,0.78)" : "rgba(148,163,184,0.30)",
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#000",
        shadowOpacity: 0.25,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 7 },
        elevation: 10,
      }}
    >
      {badge !== undefined && <FloatingBadge value={badge} bg={badgeColor} />}
      <Text style={{ fontSize: 24 }}>{icon}</Text>
      {label ? (
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{
            color: "white",
            marginTop: 3,
            fontSize: 10,
            fontWeight: "900",
            textAlign: "center",
            maxWidth: SIDE_BUTTON_SIZE - 8,
            includeFontPadding: false,
          }}
        >
          {label}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

function StatusPill({
  online,
  loading,
  onPress,
}: {
  online: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.88}
      disabled={loading}
      onPress={onPress}
      style={{
        position: "absolute",
        top: 16,
        alignSelf: "center",
        minWidth: 190,
        height: 58,
        borderRadius: 29,
        backgroundColor: "rgba(2,6,23,0.94)",
        borderWidth: 1.4,
        borderColor: "rgba(148,163,184,0.28)",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 22,
        shadowColor: "#000",
        shadowOpacity: 0.28,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 12,
        opacity: loading ? 0.7 : 1,
        zIndex: 20,
      }}
    >
      <View
        style={{
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: online ? "#22C55E" : "#EF4444",
          marginRight: 12,
        }}
      />
      <Text
        style={{
          color: online ? "#22C55E" : "#FCA5A5",
          fontSize: 22,
          fontWeight: "900",
          letterSpacing: 0.6,
        }}
      >
        {loading ? "..." : online ? "ONLINE" : "OFFLINE"}
      </Text>
      <Text style={{ color: "#E5E7EB", fontSize: 19, fontWeight: "900", marginLeft: 12 }}>
        ⌄
      </Text>
    </TouchableOpacity>
  );
}

function BrandMark() {
  return (
    <View
      style={{
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: "rgba(2,6,23,0.96)",
        borderWidth: 2,
        borderColor: "#F97316",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        shadowColor: "#F97316",
        shadowOpacity: 0.35,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 0 },
        elevation: 8,
      }}
    >
      <Image
        source={require("../../assets/brand/mmd-logo.png")}
        style={{ width: 38, height: 38 }}
        resizeMode="contain"
      />
    </View>
  );
}

function RestaurantMapPin({ label }: { label: string }) {
  return (
    <View
      style={{
        width: 82,
        height: 82,
        borderRadius: 41,
        backgroundColor: "rgba(59,130,246,0.18)",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: 54,
          height: 64,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <BrandMark />
        <View
          style={{
            marginTop: -3,
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: "#3B82F6",
            borderWidth: 3,
            borderColor: "#FFFFFF",
          }}
        />
      </View>
    </View>
  );
}

function OrderMapPin({ status, index }: { status: string | null; index: number }) {
  const color = statusColor(status);
  const label = statusLabel(status);

  return (
    <View
      style={{
        minWidth: 42,
        minHeight: 42,
        borderRadius: 21,
        paddingHorizontal: 9,
        paddingVertical: 5,
        backgroundColor: color,
        borderWidth: 2,
        borderColor: "rgba(255,255,255,0.65)",
        alignItems: "center",
        justifyContent: "center",
        shadowColor: color,
        shadowOpacity: 0.45,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 8,
      }}
    >
      <Text style={{ color: "white", fontSize: 16, fontWeight: "900" }}>{index + 1}</Text>
      <Text
        numberOfLines={1}
        style={{ color: "rgba(255,255,255,0.90)", fontSize: 7, fontWeight: "900", marginTop: -1 }}
      >
        {label}
      </Text>
    </View>
  );
}

function DriverMapPin() {
  return (
    <View
      style={{
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: "#38BDF8",
        borderWidth: 2,
        borderColor: "#FFFFFF",
        shadowColor: "#38BDF8",
        shadowOpacity: 0.55,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 0 },
        elevation: 8,
      }}
    />
  );
}

function LegendItem({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginRight: 16 }}>
      <View
        style={{
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: color,
          marginRight: 8,
        }}
      />
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "800", maxWidth: 82 }}
      >
        {label}
      </Text>
    </View>
  );
}

function TopLegendPill({
  items,
}: {
  items: Array<{ label: string; color: string }>;
}) {
  return (
    <View
      pointerEvents="none"
      style={{
        minHeight: 42,
        borderRadius: 21,
        paddingHorizontal: 10,
        backgroundColor: "rgba(2,6,23,0.90)",
        borderWidth: 1,
        borderColor: "rgba(148,163,184,0.28)",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#000",
        shadowOpacity: 0.22,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 7 },
        elevation: 10,
        zIndex: 18,
      }}
    >
      {items.map((item) => (
        <LegendItem key={item.label} label={item.label} color={item.color} />
      ))}
    </View>
  );
}

function BottomMapButton({
  icon,
  label,
  onPress,
  badge,
  badgeColor,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  badge?: number | string;
  badgeColor?: string;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: BOTTOM_BUTTON_MIN_HEIGHT,
        borderRadius: 20,
        backgroundColor: "rgba(2,6,23,0.92)",
        borderWidth: 1.2,
        borderColor: "rgba(148,163,184,0.30)",
        alignItems: "center",
        justifyContent: "center",
        marginHorizontal: 3,
        shadowColor: "#000",
        shadowOpacity: 0.24,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 7 },
        elevation: 10,
      }}
    >
      {badge !== undefined && <FloatingBadge value={badge} bg={badgeColor} />}
      <Text style={{ fontSize: 24 }}>{icon}</Text>
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        style={{
          color: "#FFFFFF",
          fontSize: 9.5,
          fontWeight: "900",
          marginTop: 4,
          textAlign: "center",
          maxWidth: 76,
          includeFontPadding: false,
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}


const restaurantStyles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#020617",
  },
  root: {
    flex: 1,
    backgroundColor: "#020617",
  },
  map: {
    flex: 1,
  },
  loadingSafe: {
    flex: 1,
    backgroundColor: "#020617",
    alignItems: "center",
    justifyContent: "center",
  },
});


export function RestaurantHomeScreen({ navigation }: any) {
  const { t } = useTranslation();
  const soundRef = useRef<Audio.Sound | null>(null);
  const isFocused = useIsFocused();
  const cameraRef = useRef<Mapbox.Camera | null>(null);

  useEffect(() => {
    ensureMapboxTokenApplied();
  }, []);

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [restaurantUserId, setRestaurantUserId] = useState<string | null>(null);
  const [restaurantName, setRestaurantName] = useState("Restaurant");
  const [statsLoading, setStatsLoading] = useState(false);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [restaurantOnline, setRestaurantOnline] = useState(true);
  const [mapOrders, setMapOrders] = useState<RestaurantMapOrder[]>([]);
  const [nearbyDrivers, setNearbyDrivers] = useState<NearbyDriver[]>([]);
  const [restaurantCoordinate, setRestaurantCoordinate] =
    useState<[number, number]>(DEFAULT_RESTAURANT_COORDINATE);
  const [profileNeedsSetup, setProfileNeedsSetup] = useState(false);
  const [mapStyleURL, setMapStyleURL] = useState(getMapStyleStreets());
  const [zoomLevel, setZoomLevel] = useState(12);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [showDrivers, setShowDrivers] = useState(true);
  const [liveOrder, setLiveOrder] = useState<RestaurantMapOrder | null>(null);
  const [orderActionLoading, setOrderActionLoading] = useState(false);
  const { features: platformFeatures, refresh: refreshRestaurantPlatformFeatures } =
    useRestaurantPlatformFeatures();

  const pinPulseAnim = useRef(new Animated.Value(0)).current;
  const liveOrderAnim = useRef(new Animated.Value(0)).current;

  const [stats, setStats] = useState<DashboardStats>({
    ordersToday: 0,
    revenueToday: 0,
    pendingOrders: 0,
    currency: "USD",
  });

  const activeRestaurantId = restaurantUserId || FALLBACK_RESTAURANT_ID;

  const loadDashboardStats = useCallback(async () => {
    if (!activeRestaurantId) return;

    try {
      setStatsLoading(true);

      const fromISO = startOfTodayLocalISOString();

      const [todayOrdersRes, pendingRes] = await Promise.all([
        supabase
          .from("orders")
          .select("id,kind,status,total,subtotal,tax,currency,created_at")
          .eq("kind", "food")
          .eq("payment_status", "paid")
          .eq("restaurant_id", activeRestaurantId)
          .gte("created_at", fromISO),
        supabase
          .from("orders")
          .select("id,kind,status,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,created_at,total")
          .eq("kind", "food")
          .eq("payment_status", "paid")
          .eq("restaurant_id", activeRestaurantId)
          .in("status", ["pending", "accepted", "prepared", "ready"])
          .order("created_at", { ascending: false }),
      ]);

      if (todayOrdersRes.error) {
        console.log("Restaurant dashboard todayOrders error:", todayOrdersRes.error);
      }

      if (pendingRes.error) {
        console.log("Restaurant dashboard pending error:", pendingRes.error);
      }

      const rows = todayOrdersRes.data ?? [];
      const currency = rows.find((r: any) => r?.currency)?.currency || "USD";

      const ordersToday = rows.length;
      const revenueToday = rows.reduce((sum: number, row: any) => {
        return sum + buildOrderAmount(row);
      }, 0);

      const pendingRows = ((pendingRes.data ?? []) as RestaurantMapOrder[]).filter(
        (row) => String(row?.kind ?? "food").toLowerCase() === "food"
      );
      const pendingOrders = pendingRows.length;
      setMapOrders(pendingRows);

      setStats({
        ordersToday,
        revenueToday,
        pendingOrders,
        currency,
      });
    } catch (e) {
      console.log("Restaurant dashboard stats exception:", e);
    } finally {
      setStatsLoading(false);
    }
  }, [activeRestaurantId]);

  const loadNearbyDrivers = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("driver_locations")
        .select("driver_id,lat,lng,updated_at")
        .order("updated_at", { ascending: false })
        .limit(MAX_NEARBY_DRIVERS);

      if (error) {
        console.log("Restaurant nearby drivers load error:", error);
        setNearbyDrivers([]);
        return;
      }

      setNearbyDrivers(((data ?? []) as NearbyDriver[]).filter(hasValidLatLng));
    } catch (e) {
      console.log("Restaurant nearby drivers exception:", e);
      setNearbyDrivers([]);
    }
  }, []);

  const loadRestaurantProfile = useCallback(async (uid: string) => {
    try {
      const { data, error } = await supabase
        .from("restaurant_profiles")
        .select("restaurant_name,address,status,is_accepting_orders,location_lat,location_lng")
        .eq("user_id", uid)
        .maybeSingle();

      if (error) {
        console.log("Restaurant profile load error:", error);
        return;
      }

      const profile = (data as RestaurantProfileLite | null) ?? null;
      const nextName = String(profile?.restaurant_name || "").trim();
      const profileCoordinate = coordinateFromLatLng(
        profile?.location_lat,
        profile?.location_lng
      );

      if (nextName) {
        setRestaurantName(nextName);
      } else {
        setRestaurantName("Restaurant");
      }

      const hasAddress = String(profile?.address || "").trim().length > 0;
      const status = String(profile?.status || "").trim().toLowerCase();
      const isProfileReady =
        !!profile &&
        !!nextName &&
        !!hasAddress &&
        !!profileCoordinate &&
        status === "approved";

      setProfileNeedsSetup(!isProfileReady);

      if (profileCoordinate) {
        setRestaurantCoordinate(profileCoordinate);
      }

      if (typeof profile?.is_accepting_orders === "boolean") {
        setRestaurantOnline(profile.is_accepting_orders);
      } else {
        setRestaurantOnline(false);
      }
    } catch (e) {
      console.log("Restaurant profile load exception:", e);
    }
  }, []);

  const updateRestaurantAvailability = useCallback(
    async (nextValue: boolean) => {
      if (!restaurantUserId) return;

      if (nextValue) {
        const scopeFeatures = await refreshRestaurantPlatformFeatures();
        if (!scopeFeatures.can_accept_orders) {
          Alert.alert(
            t("common.errorTitle", "Error"),
            scopeFeatures.message ??
              t(
                "restaurant.platformUnavailable",
                "New orders are not available in your restaurant area right now."
              )
          );
          return;
        }
      }

      try {
        setAvailabilityLoading(true);

        const nowIso = new Date().toISOString();

        const { error } = await supabase
          .from("restaurant_profiles")
          .update({
            is_accepting_orders: nextValue,
            updated_at: nowIso,
          })
          .eq("user_id", restaurantUserId);

        if (error) {
          console.log("Restaurant availability update failed:", error);
          return Alert.alert(
            t("common.errorTitle", "Error"),
            error.message ||
              t(
                "restaurant.dashboard.availabilityUpdateFailed",
                "Unable to change restaurant status."
              )
          );
        }

        setRestaurantOnline(nextValue);
      } catch (e: any) {
        Alert.alert(
          t("common.errorTitle", "Error"),
          e?.message ??
            t(
              "restaurant.dashboard.availabilityUpdateFailed",
              "Unable to change restaurant status."
            )
        );
      } finally {
        setAvailabilityLoading(false);
      }
    },
    [restaurantUserId, refreshRestaurantPlatformFeatures, t]
  );

  const handleToggleAvailability = useCallback(() => {
    if (profileNeedsSetup) {
      Alert.alert(
        t("restaurant.dashboard.setupRequiredTitle", "Profil incomplet"),
        t(
          "restaurant.dashboard.setupRequiredBody",
          "Complète le nom, l’adresse et les coordonnées GPS du restaurant avant de passer en ligne."
        )
      );
      return;
    }

    const nextValue = !restaurantOnline;

    Alert.alert(
      restaurantOnline
        ? t("restaurant.dashboard.goOfflineTitle", "Go offline")
        : t("restaurant.dashboard.goOnlineTitle", "Go online"),
      restaurantOnline
        ? t(
            "restaurant.dashboard.goOfflineConfirm",
            "Stop receiving new orders for now?"
          )
        : t(
            "restaurant.dashboard.goOnlineConfirm",
            "Start receiving new orders now?"
          ),
      [
        { text: t("common.cancel", "Cancel"), style: "cancel" },
        {
          text: t("common.yes", "Yes"),
          style: "default",
          onPress: () => {
            void updateRestaurantAvailability(nextValue);
          },
        },
      ]
    );
  }, [profileNeedsSetup, restaurantOnline, t, updateRestaurantAvailability]);

  const refreshLiveMap = useCallback(() => {
    void loadDashboardStats();
    void loadNearbyDrivers();
  }, [loadDashboardStats, loadNearbyDrivers]);

  const openRestaurantOrderDetails = useCallback(
    (orderId: string) => {
      navigation.navigate("RestaurantOrderDetails", { orderId });
    },
    [navigation]
  );

  const handleOpenMapOrder = useCallback((order: RestaurantMapOrder) => {
    setLiveOrder(order);
  }, []);

  const rejectLiveOrder = useCallback(
    async (order: RestaurantMapOrder) => {
      if (!activeRestaurantId || !order?.id) return;

      try {
        setOrderActionLoading(true);
        const { postRestaurantOrderReject } = await import("../lib/restaurantOrderStatusApi");
        await postRestaurantOrderReject({ orderId: order.id });
        setLiveOrder(null);
        refreshLiveMap();
      } catch (e: any) {
        Alert.alert(
          t("common.errorTitle", "Error"),
          e?.message ?? t("restaurant.orders.updateFailed", "Unable to update order.")
        );
      } finally {
        setOrderActionLoading(false);
      }
    },
    [activeRestaurantId, refreshLiveMap, t]
  );

  const updateFoodOrderStatus = useCallback(
    async (order: RestaurantMapOrder, nextStatus: "accepted" | "canceled") => {
      if (!activeRestaurantId || !order?.id) return;

      if (nextStatus === "canceled") {
        void rejectLiveOrder(order);
        return;
      }

      const scopeFeatures = await refreshRestaurantPlatformFeatures();
      if (!scopeFeatures.can_accept_orders) {
        Alert.alert(
          t("common.errorTitle", "Error"),
          scopeFeatures.message ??
            t(
              "restaurant.platformUnavailable",
              "New orders are not available in your restaurant area right now."
            )
        );
        return;
      }

      try {
        setOrderActionLoading(true);

        const { postRestaurantOrderStatus } = await import("../lib/restaurantOrderStatusApi");
        await postRestaurantOrderStatus({
          orderId: order.id,
          status: "accepted",
        });

        setLiveOrder(null);
        refreshLiveMap();
      } catch (e: any) {
        Alert.alert(
          t("common.errorTitle", "Error"),
          e?.message ?? t("restaurant.orders.updateFailed", "Unable to update order.")
        );
      } finally {
        setOrderActionLoading(false);
      }
    },
    [activeRestaurantId, refreshLiveMap, refreshRestaurantPlatformFeatures, rejectLiveOrder, t]
  );

  const handleAcceptLiveOrder = useCallback(() => {
    if (!liveOrder) return;
    void updateFoodOrderStatus(liveOrder, "accepted");
  }, [liveOrder, updateFoodOrderStatus]);

  const handleRejectLiveOrder = useCallback(() => {
    if (!liveOrder) return;

    Alert.alert(
      t("restaurant.orders.rejectTitle", "Reject order"),
      t("restaurant.orders.rejectConfirm", "Reject this order?"),
      [
        { text: t("common.cancel", "Cancel"), style: "cancel" },
        {
          text: t("common.yes", "Yes"),
          style: "destructive",
          onPress: () => void updateFoodOrderStatus(liveOrder, "canceled"),
        },
      ]
    );
  }, [liveOrder, t, updateFoodOrderStatus]);

  useEffect(() => {
    let cancelled = false;

    const syncKeepAwake = async () => {
      try {
        if (!checkingAuth && restaurantOnline) {
          await KeepAwake.activateKeepAwakeAsync(RESTAURANT_ONLINE_KEEP_AWAKE_TAG);
          return;
        }

        KeepAwake.deactivateKeepAwake(RESTAURANT_ONLINE_KEEP_AWAKE_TAG);
      } catch (e) {
        if (IS_DEV && !cancelled) {
          console.log("Restaurant keep awake sync error:", e);
        }
      }
    };

    void syncKeepAwake();

    return () => {
      cancelled = true;
      try {
        KeepAwake.deactivateKeepAwake(RESTAURANT_ONLINE_KEEP_AWAKE_TAG);
      } catch {}
    };
  }, [checkingAuth, restaurantOnline]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") return;

      refreshLiveMap();

      if (restaurantOnline) {
        KeepAwake.activateKeepAwakeAsync(RESTAURANT_ONLINE_KEEP_AWAKE_TAG).catch((e) => {
          if (IS_DEV) {
            console.log("Restaurant keep awake resume error:", e);
          }
        });
      }
    });

    return () => {
      try {
        sub.remove();
      } catch {}
    };
  }, [refreshLiveMap, restaurantOnline]);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data.session ?? null;

        if (!alive) return;

        if (!session?.user?.id) {
          navigation.replace("RestaurantAuth");
          return;
        }

        const uid = session.user.id;

        const { data: profile, error: roleError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", uid)
          .maybeSingle();

        if (roleError) {
          console.log("RestaurantHome role guard error:", roleError);
        }

        const currentRole = String((profile as any)?.role ?? "")
          .trim()
          .toLowerCase();

        if (currentRole === "driver") {
          navigation.reset({
            index: 0,
            routes: [{ name: "DriverTabs" }],
          });
          return;
        }

        if (currentRole === "client") {
          navigation.reset({
            index: 0,
            routes: [{ name: "ClientHome" }],
          });
          return;
        }

        if (currentRole && currentRole !== "restaurant") {
          navigation.reset({
            index: 0,
            routes: [{ name: "RoleSelect" }],
          });
          return;
        }

        setRestaurantUserId(uid);
        await loadRestaurantProfile(uid);
        setCheckingAuth(false);
      } catch {
        if (!alive) return;
        navigation.replace("RestaurantAuth");
      }
    })();

    return () => {
      alive = false;
    };
  }, [navigation, loadRestaurantProfile]);

  useEffect(() => {
    if (checkingAuth) return;
    refreshLiveMap();
  }, [checkingAuth, refreshLiveMap]);

  useEffect(() => {
    if (checkingAuth || !isFocused) return;
    refreshLiveMap();
  }, [checkingAuth, isFocused, refreshLiveMap]);

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pinPulseAnim, {
          toValue: 1,
          duration: 1150,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pinPulseAnim, {
          toValue: 0,
          duration: 1150,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    pulse.start();
    return () => pulse.stop();
  }, [pinPulseAnim]);

  useEffect(() => {
    Animated.timing(liveOrderAnim, {
      toValue: liveOrder ? 1 : 0,
      duration: liveOrder ? 220 : 160,
      easing: liveOrder ? Easing.out(Easing.ease) : Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [liveOrder, liveOrderAnim]);

  useEffect(() => {
    (async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: true,
        });
      } catch {}
    })();
  }, []);

  const ensureSoundLoaded = useCallback(async () => {
    if (soundRef.current) return;

    const { sound } = await Audio.Sound.createAsync(
      require("../../assets/sounds/new_order.wav"),
      { shouldPlay: false, volume: 1.0 }
    );
    soundRef.current = sound;
  }, []);

  const playRing = useCallback(async () => {
    try {
      await ensureSoundLoaded();

      try {
        await soundRef.current?.stopAsync();
      } catch {}

      try {
        await soundRef.current?.setPositionAsync(0);
      } catch {}

      await soundRef.current?.playAsync();
    } catch {}
  }, [ensureSoundLoaded]);

  useEffect(() => {
    if (checkingAuth || !activeRestaurantId) return;

    const channel = supabase
      .channel(`restaurant-global-${activeRestaurantId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "orders",
          filter: `restaurant_id=eq.${activeRestaurantId}`,
        },
        async (payload) => {
          const row: any = payload.new;

          const isFoodOrder = String(row?.kind ?? "food").toLowerCase() === "food";
          const isPaid =
            String(row?.payment_status ?? "").trim().toLowerCase() === "paid";

          if (
            restaurantOnline &&
            isFocused &&
            row?.status === "pending" &&
            isFoodOrder &&
            isPaid
          ) {
            setLiveOrder({
              id: String(row.id),
              kind: "food",
              status: row.status ?? "pending",
              pickup_lat: row.pickup_lat ?? null,
              pickup_lng: row.pickup_lng ?? null,
              dropoff_lat: row.dropoff_lat ?? null,
              dropoff_lng: row.dropoff_lng ?? null,
              created_at: row.created_at ?? null,
              total: Number.isFinite(Number(row.total)) ? Number(row.total) : null,
            });
            await playRing();
          }

          refreshLiveMap();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `restaurant_id=eq.${activeRestaurantId}`,
        },
        async (payload) => {
          const row: any = payload.new;
          const isFoodOrder = String(row?.kind ?? "food").toLowerCase() === "food";
          const isPaid =
            String(row?.payment_status ?? "").trim().toLowerCase() === "paid";

          if (!isFoodOrder || !isPaid) return;

          setLiveOrder((current): RestaurantMapOrder | null => {
            if (!current || current.id !== String(row?.id ?? "")) {
              return current;
            }

            return {
              ...current,
              status: row.status ?? current.status,
              pickup_lat: row.pickup_lat ?? current.pickup_lat,
              pickup_lng: row.pickup_lng ?? current.pickup_lng,
              dropoff_lat: row.dropoff_lat ?? current.dropoff_lat,
              dropoff_lng: row.dropoff_lng ?? current.dropoff_lng,
              total: Number.isFinite(Number(row.total))
                ? Number(row.total)
                : current.total,
            };
          });

          refreshLiveMap();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [
    isFocused,
    checkingAuth,
    playRing,
    activeRestaurantId,
    refreshLiveMap,
    restaurantOnline,
  ]);

  useEffect(() => {
    return () => {
      try {
        soundRef.current?.unloadAsync();
      } catch {}
      soundRef.current = null;
    };
  }, []);

  const avatarLetter = useMemo(() => {
    const raw = String(restaurantName || "").trim();
    return raw ? raw.charAt(0).toUpperCase() : "R";
  }, [restaurantName]);

  const visibleMapOrders = useMemo(() => {
    return [...mapOrders]
      .filter((order) => orderCoordinate(order) !== null)
      .sort((a, b) => {
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, MAX_VISIBLE_MAP_ORDERS);
  }, [mapOrders]);

  const visibleDrivers = useMemo(() => {
    return nearbyDrivers
      .filter(hasValidLatLng)
      .map((driver) => ({
        ...driver,
        distanceMiles: distanceMilesBetweenCoordinates(restaurantCoordinate, [
          driver.lng,
          driver.lat,
        ]),
      }))
      .filter((driver) => driver.distanceMiles <= 8)
      .sort((a, b) => a.distanceMiles - b.distanceMiles)
      .slice(0, MAX_NEARBY_DRIVERS);
  }, [nearbyDrivers, restaurantCoordinate]);

  const heatmapPoints = useMemo(() => {
    if (!showHeatmap) return [];

    return visibleMapOrders
      .map((order, index) => {
        const coords = orderCoordinate(order);
        if (!coords) return null;
        const [lng, lat] = coords;
        return {
          id: `heat-${order.id}`,
          lng,
          lat,
          weight: Math.max(1, MAX_VISIBLE_MAP_ORDERS - index),
        };
      })
      .filter(Boolean) as MapPoint[];
  }, [showHeatmap, visibleMapOrders]);

  const surgePoints = useMemo(() => {
    if (!showHeatmap) return [];

    const pendingCount = visibleMapOrders.filter(
      (order) => String(order.status ?? "").toLowerCase() === "pending"
    ).length;

    if (pendingCount < 3) return [];

    return [
      {
        id: "restaurant-surge-main",
        lng: restaurantCoordinate[0],
        lat: restaurantCoordinate[1],
        weight: pendingCount,
      },
    ];
  }, [restaurantCoordinate, showHeatmap, visibleMapOrders]);

  const routeLines = useMemo(() => {
    if (!showRoutes) return [];

    return visibleMapOrders
      .map((order) => {
        const coords = orderCoordinate(order);
        if (!coords) return null;
        return {
          id: `route-${order.id}`,
          coordinates: [restaurantCoordinate, coords] as [number, number][],
        };
      })
      .filter(Boolean) as Array<{ id: string; coordinates: [number, number][] }>;
  }, [restaurantCoordinate, showRoutes, visibleMapOrders]);

  const aiDispatchInsight = useMemo(() => {
    if (!restaurantOnline) {
      return t(
        "restaurant.dashboard.aiOffline",
        "AI dispatch paused while restaurant is offline."
      );
    }

    if (stats.pendingOrders >= 5) {
      return t(
        "restaurant.dashboard.aiHighDemand",
        "AI dispatch: high demand detected. Prioritize ready orders and keep prep times tight."
      );
    }

    if (visibleDrivers.length === 0 && stats.pendingOrders > 0) {
      return t(
        "restaurant.dashboard.aiNeedDrivers",
        "AI dispatch: orders are active, but no nearby drivers were detected yet."
      );
    }

    if (visibleDrivers.length >= 3) {
      return t(
        "restaurant.dashboard.aiDriversReady",
        "AI dispatch: nearby drivers available. Keep ready orders moving."
      );
    }

    return t(
      "restaurant.dashboard.aiStable",
      "AI dispatch: demand is stable. Map is monitoring new requests live."
    );
  }, [restaurantOnline, stats.pendingOrders, t, visibleDrivers.length]);

  const pinPulseScale = pinPulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.12],
  });

  const pinPulseOpacity = pinPulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.74],
  });

  if (checkingAuth) {
    return (
      <SafeAreaView style={restaurantStyles.loadingSafe}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator />
        <Text style={{ color: "white", marginTop: 10 }}>
          {t("common.loading", "Chargement…")}
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={restaurantStyles.safe}>
      <StatusBar barStyle="light-content" />

      <View style={restaurantStyles.root}>
        <Mapbox.MapView
          style={restaurantStyles.map}
          styleURL={mapStyleURL || getMapStyleStreets()}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
          surfaceView={false}
        >
          <Mapbox.UserLocation visible={false} showsUserHeadingIndicator />
          <Mapbox.Camera
            ref={cameraRef}
            zoomLevel={zoomLevel}
            centerCoordinate={restaurantCoordinate}
            animationMode="flyTo"
            animationDuration={700}
          />

          {heatmapPoints.length > 0 && (
            <Mapbox.ShapeSource
              id="restaurant-heatmap-source"
              shape={makePointFeatureCollection(heatmapPoints)}
            >
              <Mapbox.CircleLayer
                id="restaurant-heatmap-layer"
                style={{
                  circleRadius: [
                    "interpolate",
                    ["linear"],
                    ["get", "weight"],
                    1,
                    18,
                    12,
                    54,
                  ] as any,
                  circleColor: "#F97316",
                  circleOpacity: 0.14,
                  circleBlur: 0.85,
                }}
              />
            </Mapbox.ShapeSource>
          )}

          {surgePoints.length > 0 && (
            <Mapbox.ShapeSource
              id="restaurant-surge-source"
              shape={makePointFeatureCollection(surgePoints)}
            >
              <Mapbox.CircleLayer
                id="restaurant-surge-layer"
                style={{
                  circleRadius: 92,
                  circleColor: "#EF4444",
                  circleOpacity: 0.12,
                  circleStrokeWidth: 2,
                  circleStrokeColor: "rgba(248,113,113,0.45)",
                }}
              />
            </Mapbox.ShapeSource>
          )}

          {routeLines.length > 0 && (
            <Mapbox.ShapeSource
              id="restaurant-route-lines-source"
              shape={makeLineFeatureCollection(routeLines)}
            >
              <Mapbox.LineLayer
                id="restaurant-route-lines-layer"
                style={{
                  lineColor: "#60A5FA",
                  lineOpacity: 0.32,
                  lineWidth: 2.2,
                  lineDasharray: [2, 2],
                }}
              />
            </Mapbox.ShapeSource>
          )}

          <Mapbox.PointAnnotation id="restaurant-home-pin" coordinate={restaurantCoordinate}>
            <RestaurantMapPin label={avatarLetter} />
          </Mapbox.PointAnnotation>

          {visibleMapOrders.map((order, index) => {
            const coordinate = orderCoordinate(order);
            if (!coordinate) return null;

            return (
              <Mapbox.PointAnnotation
                key={`restaurant-order-${order.id}`}
                id={`restaurant-order-${order.id}`}
                coordinate={coordinate}
              >
                <TouchableOpacity activeOpacity={0.9} onPress={() => handleOpenMapOrder(order)}>
                  <Animated.View
                    style={{
                      opacity: pinPulseOpacity,
                      transform: [{ scale: pinPulseScale }],
                    }}
                  >
                    <OrderMapPin status={order.status} index={index} />
                  </Animated.View>
                </TouchableOpacity>
              </Mapbox.PointAnnotation>
            );
          })}

          {showDrivers &&
            visibleDrivers.map((driver) => (
              <Mapbox.PointAnnotation
                key={`restaurant-driver-${driver.driver_id}`}
                id={`restaurant-driver-${driver.driver_id}`}
                coordinate={[driver.lng, driver.lat]}
              >
                <DriverMapPin />
              </Mapbox.PointAnnotation>
            ))}
        </Mapbox.MapView>

        <StatusPill
          online={profileNeedsSetup ? false : restaurantOnline}
          loading={availabilityLoading}
          onPress={handleToggleAvailability}
        />

        {profileNeedsSetup && (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => navigation.navigate("RestaurantSetup")}
            style={{
              position: "absolute",
              top: 82,
              left: 16,
              right: 16,
              zIndex: 30,
              paddingHorizontal: 14,
              paddingVertical: 12,
              borderRadius: 18,
              backgroundColor: "rgba(127,29,29,0.94)",
              borderWidth: 1,
              borderColor: "rgba(248,113,113,0.45)",
            }}
          >
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "900" }}
            >
              {t("restaurant.dashboard.setupRequiredTitle", "Profil incomplet")}
            </Text>
            <Text
              numberOfLines={2}
              ellipsizeMode="tail"
              style={{
                color: "#FECACA",
                fontSize: 10.5,
                fontWeight: "700",
                marginTop: 3,
                lineHeight: 14,
                flexShrink: 1,
              }}
            >
              {t(
                "restaurant.dashboard.setupRequiredBody",
                "Complète le nom, l’adresse et les coordonnées GPS du restaurant avant de passer en ligne."
              )}
            </Text>
          </TouchableOpacity>
        )}

        {liveOrder && (
          <Animated.View
            style={{
              position: "absolute",
              left: 88,
              right: 88,
              top: 92,
              zIndex: 35,
              opacity: liveOrderAnim,
              transform: [
                {
                  translateY: liveOrderAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-16, 0],
                  }),
                },
              ],
            }}
          >
            <View
              style={{
                borderRadius: 24,
                padding: 14,
                backgroundColor: "rgba(2,6,23,0.97)",
                borderWidth: 1.4,
                borderColor: "rgba(249,115,22,0.72)",
                shadowColor: "#000",
                shadowOpacity: 0.34,
                shadowRadius: 18,
                shadowOffset: { width: 0, height: 8 },
                elevation: 16,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={{ color: "#FED7AA", fontSize: 12, fontWeight: "900" }}>
                    {t("restaurant.dashboard.newFoodOrder", "New food order")}
                  </Text>
                  <Text style={{ color: "#FFFFFF", fontSize: 19, fontWeight: "900", marginTop: 3 }}>
                    #{liveOrder.id.slice(0, 8)} · {formatMoney(Number(liveOrder.total ?? 0), stats.currency)}
                  </Text>
                  <Text style={{ color: "#94A3B8", fontSize: 11, fontWeight: "700", marginTop: 3 }}>
                    {statusLabel(liveOrder.status)} · {liveOrder.created_at ? new Date(liveOrder.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Live"}
                  </Text>
                </View>

                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => setLiveOrder(null)}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "rgba(15,23,42,0.95)",
                    borderWidth: 1,
                    borderColor: "rgba(148,163,184,0.25)",
                  }}
                >
                  <Text style={{ color: "#CBD5E1", fontSize: 18, fontWeight: "900" }}>×</Text>
                </TouchableOpacity>
              </View>

              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                <TouchableOpacity
                  activeOpacity={0.88}
                  disabled={orderActionLoading}
                  onPress={handleRejectLiveOrder}
                  style={{
                    flex: 1,
                    minHeight: 46,
                    borderRadius: 999,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "rgba(127,29,29,0.86)",
                    borderWidth: 1,
                    borderColor: "rgba(248,113,113,0.45)",
                    opacity: orderActionLoading ? 0.65 : 1,
                  }}
                >
                  <Text style={{ color: "#FECACA", fontSize: 12, fontWeight: "900" }}>
                    {t("common.reject", "Reject")}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.88}
                  onPress={() => openRestaurantOrderDetails(liveOrder.id)}
                  style={{
                    flex: 1,
                    minHeight: 46,
                    borderRadius: 999,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "rgba(30,41,59,0.95)",
                    borderWidth: 1,
                    borderColor: "rgba(148,163,184,0.28)",
                  }}
                >
                  <Text style={{ color: "#E5E7EB", fontSize: 12, fontWeight: "900" }}>
                    {t("common.view", "View")}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.88}
                  disabled={orderActionLoading}
                  onPress={handleAcceptLiveOrder}
                  style={{
                    flex: 1,
                    minHeight: 46,
                    borderRadius: 999,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "#22C55E",
                    opacity: orderActionLoading ? 0.65 : 1,
                  }}
                >
                  <Text style={{ color: "#052E16", fontSize: 12, fontWeight: "900" }}>
                    {orderActionLoading ? "..." : t("common.accept", "Accept")}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>
        )}

        <View
          style={{
            position: "absolute",
            left: 12,
            top: 92,
            bottom: FLOATING_SIDE_BOTTOM_OFFSET,
            justifyContent: "space-between",
            zIndex: 15,
          }}
        >
          <MapActionButton
            icon="▦"
            label="Dash"
            onPress={() =>
              Alert.alert(
                t("restaurant.dashboard.title", "Restaurant Dashboard"),
                `${t("restaurant.dashboard.ordersToday", "Orders today")}: ${stats.ordersToday}\n` +
                  `${t("restaurant.dashboard.revenueToday", "Revenue today")}: ${formatMoney(stats.revenueToday, stats.currency)}\n` +
                  `${t("restaurant.dashboard.pendingOrders", "Pending orders")}: ${stats.pendingOrders}\n` +
                  `${t("restaurant.dashboard.driversNearby", "Drivers nearby")}: ${visibleDrivers.length}\n` +
                  `${t("restaurant.dashboard.surgeZone", "Surge zone")}: ${surgePoints.length > 0 ? t("common.yes", "Yes") : t("common.no", "No")}`
              )
            }
          />
          <MapActionButton
            icon="📊"
            label="Stats"
            badge={stats.ordersToday > 0 ? stats.ordersToday : undefined}
            badgeColor="#2563EB"
            onPress={() => navigation.navigate("RestaurantEarnings")}
          />
          <MapActionButton
            icon="💼"
            label="Finance"
            onPress={() => navigation.navigate("RestaurantFinancialCenter")}
          />
          <MapActionButton
            icon="📋"
            label="Orders"
            badge={stats.pendingOrders > 0 ? stats.pendingOrders : undefined}
            badgeColor="#EF4444"
            onPress={() => navigation.navigate("RestaurantOrders")}
          />
          <MapActionButton
            icon="🚘"
            label="Drivers"
            badge={visibleDrivers.length > 0 ? visibleDrivers.length : undefined}
            badgeColor="#2563EB"
            active={showDrivers}
            onPress={() => setShowDrivers((value) => !value)}
          />
          <MapActionButton
            icon="◎"
            label="Heatmap"
            active={showHeatmap}
            onPress={() => setShowHeatmap((value) => !value)}
          />
          <MapActionButton
            icon="🧠"
            label="AI"
            onPress={() =>
              Alert.alert(
                t("restaurant.dashboard.aiDispatch", "AI Dispatch"),
                aiDispatchInsight
              )
            }
          />
          <MapActionButton
            icon="⚙️"
            label="Settings"
            onPress={() => navigation.navigate("RestaurantSecurity")}
          />
          <MapActionButton
            icon="👤"
            label="Account"
            onPress={() => navigation.navigate("RestaurantLanguage")}
          />
          <MapActionButton
            icon="🌐"
            label="Language"
            onPress={() => navigation.navigate("RestaurantLanguage")}
          />
        </View>

        <View
          style={{
            position: "absolute",
            right: 12,
            top: 92,
            bottom: FLOATING_SIDE_BOTTOM_OFFSET,
            justifyContent: "space-between",
            alignItems: "center",
            zIndex: 15,
          }}
        >
          <MapActionButton
            icon="🔔"
            label="Alerts"
            badge={stats.pendingOrders > 0 ? stats.pendingOrders : undefined}
            badgeColor="#EF4444"
            onPress={() => navigation.navigate("RestaurantOrders")}
          />
          <MapActionButton
            icon="⟳"
            label="Refresh"
            active={statsLoading}
            onPress={refreshLiveMap}
          />
          <MapActionButton
            icon="⌖"
            label="Center"
            onPress={() => {
              setZoomLevel((value) => (value === 12 ? 12.01 : 12));
              cameraRef.current?.setCamera({
                centerCoordinate: restaurantCoordinate,
                zoomLevel: 13,
                animationMode: "flyTo",
                animationDuration: 650,
              });
            }}
          />
          <MapActionButton
            icon="➤"
            label="Location"
            onPress={() => {
              setZoomLevel((value) => (value === 13 ? 13.01 : 13));
              cameraRef.current?.setCamera({
                centerCoordinate: restaurantCoordinate,
                zoomLevel: 14,
                animationMode: "flyTo",
                animationDuration: 650,
              });
            }}
          />
          <MapActionButton
            icon="▰"
            label="Layers"
            active={mapStyleURL === getMapStyleDark()}
            onPress={() =>
              setMapStyleURL((value) =>
                value === getMapStyleStreets() ? getMapStyleDark() : getMapStyleStreets()
              )
            }
          />
          <View
            style={{
              borderRadius: 32,
              overflow: "hidden",
              borderWidth: 1.4,
              borderColor: "rgba(148,163,184,0.30)",
              backgroundColor: "rgba(2,6,23,0.92)",
              shadowColor: "#000",
              shadowOpacity: 0.25,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 7 },
              elevation: 10,
            }}
          >
            <TouchableOpacity
              activeOpacity={0.86}
              onPress={() => setZoomLevel((value) => Math.min(16, value + 0.6))}
              style={{
                width: SIDE_BUTTON_SIZE,
                height: 56,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: "white", fontSize: 40, fontWeight: "500" }}>+</Text>
            </TouchableOpacity>
            <View style={{ height: 1, backgroundColor: "rgba(148,163,184,0.18)" }} />
            <TouchableOpacity
              activeOpacity={0.86}
              onPress={() => setZoomLevel((value) => Math.max(10, value - 0.6))}
              style={{
                width: SIDE_BUTTON_SIZE,
                height: 56,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: "white", fontSize: 40, fontWeight: "500", marginTop: -6 }}>
                −
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ position: "absolute", left: 18, right: 18, top: 18, zIndex: 16 }}>
          <View style={{ position: "absolute", left: 0 }}>
            <TopLegendPill
            items={[
              { label: "Pending", color: "#F97316" },
              { label: "Accepted", color: "#2563EB" },
            ]}
            />
          </View>

          <View style={{ position: "absolute", right: 0 }}>
            <TopLegendPill
              items={[
                { label: "Ready", color: "#22C55E" },
                { label: "Surge", color: "#EF4444" },
              ]}
            />
          </View>
        </View>

        <View
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            bottom: BOTTOM_NAV_SAFE_OFFSET,
            minHeight: 82,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            zIndex: 16,
          }}
        >
          <BottomMapButton
            icon="📋"
            label="Orders"
            badge={stats.pendingOrders > 0 ? stats.pendingOrders : undefined}
            badgeColor="#EF4444"
            onPress={() => navigation.navigate("RestaurantOrders")}
          />
          <BottomMapButton
            icon="💲"
            label="Earnings"
            onPress={() => navigation.navigate("RestaurantEarnings")}
          />
          <BottomMapButton
            icon="💼"
            label="Finance"
            onPress={() => navigation.navigate("RestaurantFinancialCenter")}
          />
          <BottomMapButton
            icon="🧾"
            label="Tax"
            onPress={() => navigation.navigate("RestaurantTax")}
          />
          <BottomMapButton
            icon="🔒"
            label="Security"
            onPress={() => navigation.navigate("RestaurantSecurity")}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}


export default RestaurantHomeScreen;
