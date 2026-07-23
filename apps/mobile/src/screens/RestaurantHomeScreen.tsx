import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
  Alert,
  Image,
  Animated,
  Easing,
  AppState,
  StyleSheet,
  useWindowDimensions,
  Linking,
  Platform,
} from "react-native";
import * as KeepAwake from "expo-keep-awake";
import Mapbox from "@rnmapbox/maps";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import {
  subscribePostgresChannel,
  unsubscribeSupabaseChannel,
} from "../lib/supabaseRealtime";
import { useIsFocused, useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { useRestaurantPlatformFeatures } from "../hooks/useRestaurantPlatformFeatures";
import { toUserFacingError } from "../lib/userFacingError";
import MarketScopePill from "../components/market/MarketScopePill";
import { resolveMarketScopeFromFeatures } from "../lib/marketScope";
import {
  ensureMapboxTokenApplied,
  getMapStyleDark,
  getMapStyleStreets,
} from "../lib/mapboxConfig";
import { registerUserPushToken } from "../lib/notifications";
import {
  fetchClientAdvertisements,
  type ClientAdvertisement,
} from "../lib/clientAdvertisementsApi";
import { resolveClientAdAction } from "../components/client/home/ClientHomeV4View";
import {
  RestaurantHomeHeader,
  RestaurantHomeSidebar,
  RestaurantHomeMapChrome,
  RH,
  RH_TABLET_BREAKPOINT,
  type MapSelection,
  type RestaurantHomeNavKey,
  type RestaurantMapStatusFilter,
} from "../features/restaurant/home";

const FALLBACK_RESTAURANT_ID = "";
const IS_DEV = typeof __DEV__ !== "undefined" ? __DEV__ : false;
const DEFAULT_RESTAURANT_COORDINATE: [number, number] = [-73.949997, 40.650002];

const MAX_VISIBLE_MAP_ORDERS = 12;
const MAX_NEARBY_DRIVERS = 8;
const RESTAURANT_ONLINE_KEEP_AWAKE_TAG = "mmd-restaurant-online";
const AVATARS_BUCKET = "avatars";

function resolveStorageUrl(bucket: string, value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const normalized = raw.replace(/^\/+/, "");
  const { data } = supabase.storage.from(bucket).getPublicUrl(normalized);
  return data?.publicUrl || null;
}

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
  is_busy?: boolean | null;
  opening_hours?: Record<string, { open?: string; close?: string }> | null;
  location_lat?: number | string | null;
  location_lng?: number | string | null;
  logo_url?: string | null;
  avatar_url?: string | null;
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

function RestaurantMapPin({ label }: { label: string }) {
  return (
    <View
      style={{
        width: 56,
        height: 68,
        alignItems: "center",
        justifyContent: "flex-start",
      }}
      accessibilityLabel={label}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 16,
          backgroundColor: "#FACC15",
          borderWidth: 2.5,
          borderColor: "#FFFFFF",
          alignItems: "center",
          justifyContent: "center",
          shadowColor: "#CA8A04",
          shadowOpacity: 0.35,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 8,
          overflow: "hidden",
        }}
      >
        <Image
          source={require("../../assets/brand/mmd-logo.png")}
          style={{ width: 34, height: 34 }}
          resizeMode="contain"
        />
      </View>
      <View
        style={{
          marginTop: -2,
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: "#EAB308",
          borderWidth: 2,
          borderColor: "#FFFFFF",
        }}
      />
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

function DriverMapPin({ active = true }: { active?: boolean }) {
  const bg = active ? "#16A34A" : "#EF4444";
  return (
    <View
      style={{
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: bg,
        borderWidth: 2.5,
        borderColor: "#FFFFFF",
        alignItems: "center",
        justifyContent: "center",
        shadowColor: bg,
        shadowOpacity: 0.4,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 8,
      }}
    >
      <Ionicons name="bicycle" size={16} color="#FFFFFF" />
    </View>
  );
}

const restaurantStyles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: RH.bg,
  },
  root: {
    flex: 1,
    backgroundColor: RH.bg,
  },
  body: {
    flex: 1,
    flexDirection: "row",
  },
  mapPane: {
    flex: 1,
    position: "relative",
  },
  map: {
    flex: 1,
  },
  loadingSafe: {
    flex: 1,
    backgroundColor: RH.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  setupBanner: {
    position: "absolute",
    top: 56,
    left: 12,
    right: 12,
    zIndex: 30,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "#7F1D1D",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.45)",
  },
  liveOrderCard: {
    position: "absolute",
    left: 12,
    right: 12,
    top: 56,
    zIndex: 35,
    borderRadius: 18,
    padding: 14,
    backgroundColor: RH.surface,
    borderWidth: 1.4,
    borderColor: "rgba(249,115,22,0.55)",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  marketWrap: {
    position: "absolute",
    left: 12,
    top: 12,
    zIndex: 18,
  },
});


export function RestaurantHomeScreen({ navigation }: any) {
  const { t } = useTranslation();
  const isFocused = useIsFocused();
  const cameraRef = useRef<Mapbox.Camera | null>(null);

  useEffect(() => {
    ensureMapboxTokenApplied();
  }, []);

  useFocusEffect(
    useCallback(() => {
      void registerUserPushToken("restaurant");
    }, []),
  );

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [restaurantUserId, setRestaurantUserId] = useState<string | null>(null);
  const [restaurantName, setRestaurantName] = useState("Restaurant");
  const [restaurantLogoUrl, setRestaurantLogoUrl] = useState<string | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [restaurantOnline, setRestaurantOnline] = useState(true);
  const [restaurantBusy, setRestaurantBusy] = useState(false);
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<RestaurantMapStatusFilter>("all");
  const [mapSelection, setMapSelection] = useState<MapSelection | null>(null);
  const [sidebarAd, setSidebarAd] = useState<ClientAdvertisement | null>(null);
  const [sidebarAdLoading, setSidebarAdLoading] = useState(false);
  const { width: windowWidth } = useWindowDimensions();
  const isTabletLayout = windowWidth >= RH_TABLET_BREAKPOINT;
  const { features: platformFeatures, refresh: refreshRestaurantPlatformFeatures } =
    useRestaurantPlatformFeatures();
  const restaurantMarket = useMemo(
    () => resolveMarketScopeFromFeatures(platformFeatures),
    [platformFeatures]
  );

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
      if (!activeRestaurantId) {
        setNearbyDrivers([]);
        return;
      }

      const { data: orderRows, error: ordersError } = await supabase
        .from("orders")
        .select("driver_id")
        .eq("restaurant_id", activeRestaurantId)
        .not("driver_id", "is", null)
        .in("status", [
          "preparing",
          "ready",
          "dispatched",
          "picked_up",
          "in_transit",
          "out_for_delivery",
        ]);

      if (ordersError) {
        console.log("Restaurant active order drivers lookup error:", ordersError);
        setNearbyDrivers([]);
        return;
      }

      const driverIds = [
        ...new Set(
          (orderRows ?? [])
            .map((row) =>
              String((row as { driver_id?: string | null }).driver_id ?? "").trim(),
            )
            .filter(Boolean),
        ),
      ];

      if (driverIds.length === 0) {
        setNearbyDrivers([]);
        return;
      }

      const { data, error } = await supabase
        .from("driver_locations")
        .select("driver_id,lat,lng,updated_at")
        .in("driver_id", driverIds)
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
  }, [activeRestaurantId]);

  const loadRestaurantProfile = useCallback(async (uid: string) => {
    try {
      let data: RestaurantProfileLite | null = null;

      const full = await supabase
        .from("restaurant_profiles")
        .select(
          "restaurant_name,address,status,is_accepting_orders,is_busy,opening_hours,location_lat,location_lng,logo_url,avatar_url",
        )
        .eq("user_id", uid)
        .maybeSingle();

      if (full.error) {
        const msg = String(full.error.message ?? "");
        // Older DBs may lack logo/avatar columns — fall back without them.
        if (/logo_url|avatar_url|column/i.test(msg)) {
          const lite = await supabase
            .from("restaurant_profiles")
            .select(
              "restaurant_name,address,status,is_accepting_orders,is_busy,opening_hours,location_lat,location_lng",
            )
            .eq("user_id", uid)
            .maybeSingle();
          if (lite.error) {
            console.log("Restaurant profile load error:", lite.error);
            return;
          }
          data = (lite.data as RestaurantProfileLite | null) ?? null;
        } else {
          console.log("Restaurant profile load error:", full.error);
          return;
        }
      } else {
        data = (full.data as RestaurantProfileLite | null) ?? null;
      }

      const profile = data;
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

      setRestaurantLogoUrl(
        resolveStorageUrl(AVATARS_BUCKET, profile?.logo_url ?? profile?.avatar_url ?? null),
      );

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
        setRestaurantOnline(profile.is_accepting_orders && profile.is_busy !== true);
      } else {
        setRestaurantOnline(false);
      }
      setRestaurantBusy(profile?.is_busy === true);
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
            // Going online clears busy; going offline keeps busy false as well.
            is_busy: false,
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
        setRestaurantBusy(false);
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

  const handleToggleBusy = useCallback(() => {
    if (profileNeedsSetup || !restaurantUserId || !restaurantOnline) {
      Alert.alert(
        t("common.errorTitle", "Error"),
        t(
          "restaurant.dashboard.busyRequiresOnline",
          "Passez en ligne avant d'activer le mode occupé.",
        ),
      );
      return;
    }

    const nextBusy = !restaurantBusy;
    Alert.alert(
      nextBusy
        ? t("restaurant.dashboard.busyTitle", "Mode occupé")
        : t("restaurant.dashboard.busyOffTitle", "Fin du mode occupé"),
      nextBusy
        ? t(
            "restaurant.dashboard.busyConfirm",
            "Suspendre les nouvelles commandes tout en restant ouvert ?",
          )
        : t(
            "restaurant.dashboard.busyOffConfirm",
            "Reprendre les nouvelles commandes ?",
          ),
      [
        { text: t("common.cancel", "Cancel"), style: "cancel" },
        {
          text: t("common.yes", "Yes"),
          onPress: () => {
            void (async () => {
              try {
                setAvailabilityLoading(true);
                const { error } = await supabase
                  .from("restaurant_profiles")
                  .update({
                    is_busy: nextBusy,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("user_id", restaurantUserId);
                if (error) throw error;
                setRestaurantBusy(nextBusy);
              } catch (e: unknown) {
                Alert.alert(
                  t("common.errorTitle", "Error"),
                  toUserFacingError(
                    e,
                    t(
                      "restaurant.dashboard.availabilityUpdateFailed",
                      "Unable to change restaurant status.",
                    ),
                  ),
                );
              } finally {
                setAvailabilityLoading(false);
              }
            })();
          },
        },
      ],
    );
  }, [profileNeedsSetup, restaurantBusy, restaurantOnline, restaurantUserId, t]);

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
    const coords = orderCoordinate(order);
    const distanceKm = coords
      ? distanceMilesBetweenCoordinates(restaurantCoordinate, coords) * 1.60934
      : null;
    setMapSelection({
      kind: "order",
      id: order.id,
      status: order.status,
      total: order.total ?? null,
      createdAt: order.created_at ?? null,
      distanceKm,
    });
  }, [restaurantCoordinate]);

  const handleOpenMapDriver = useCallback(
    (driver: NearbyDriver & { distanceMiles: number }) => {
      setMapSelection({
        kind: "driver",
        id: driver.driver_id,
        distanceKm: driver.distanceMiles * 1.60934,
        updatedAt: driver.updated_at ?? null,
      });
    },
    [],
  );

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

  // Kitchen long-ring is owned by global restaurantOrderAlertService.
  // This screen only updates the live map UI; do not gate ring on isFocused.

  useEffect(() => {
    if (checkingAuth || !activeRestaurantId) return;

    const channel = subscribePostgresChannel(`restaurant-global-${activeRestaurantId}`, [
      {
        event: "INSERT",
        table: "orders",
        filter: `restaurant_id=eq.${activeRestaurantId}`,
        callback: async (payload) => {
          const row = (payload as { new?: Record<string, unknown> }).new ?? {};

          const isFoodOrder = String(row?.kind ?? "food").toLowerCase() === "food";
          const isPaid =
            String(row?.payment_status ?? "").trim().toLowerCase() === "paid";

          if (
            restaurantOnline &&
            row?.status === "pending" &&
            isFoodOrder &&
            isPaid
          ) {
            setLiveOrder({
              id: String(row.id),
              kind: "food",
              status: (row.status as string) ?? "pending",
              pickup_lat: (row.pickup_lat as number | null) ?? null,
              pickup_lng: (row.pickup_lng as number | null) ?? null,
              dropoff_lat: (row.dropoff_lat as number | null) ?? null,
              dropoff_lng: (row.dropoff_lng as number | null) ?? null,
              created_at: (row.created_at as string | null) ?? null,
              total: Number.isFinite(Number(row.total)) ? Number(row.total) : null,
            });
          }

          refreshLiveMap();
        },
      },
      {
        event: "UPDATE",
        table: "orders",
        filter: `restaurant_id=eq.${activeRestaurantId}`,
        callback: async (payload) => {
          const row = (payload as { new?: Record<string, unknown> }).new ?? {};
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
              status: (row.status as string) ?? current.status,
              pickup_lat: (row.pickup_lat as number | null) ?? current.pickup_lat,
              pickup_lng: (row.pickup_lng as number | null) ?? current.pickup_lng,
              dropoff_lat: (row.dropoff_lat as number | null) ?? current.dropoff_lat,
              dropoff_lng: (row.dropoff_lng as number | null) ?? current.dropoff_lng,
              total: Number.isFinite(Number(row.total))
                ? Number(row.total)
                : current.total,
            };
          });

          refreshLiveMap();
        },
      },
    ]);

    return () => {
      void unsubscribeSupabaseChannel(channel);
    };
  }, [
    checkingAuth,
    activeRestaurantId,
    refreshLiveMap,
    restaurantOnline,
  ]);

  const avatarLetter = useMemo(() => {
    const raw = String(restaurantName || "").trim();
    return raw ? raw.charAt(0).toUpperCase() : "R";
  }, [restaurantName]);

  const visibleMapOrders = useMemo(() => {
    return [...mapOrders]
      .filter((order) => orderCoordinate(order) !== null)
      .filter((order) => {
        if (statusFilter === "all") return true;
        return String(order.status ?? "").trim().toLowerCase() === statusFilter;
      })
      .sort((a, b) => {
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, MAX_VISIBLE_MAP_ORDERS);
  }, [mapOrders, statusFilter]);

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

  const orderHitCollection = useMemo(() => {
    return {
      type: "FeatureCollection" as const,
      features: visibleMapOrders
        .map((order, index) => {
          const coords = orderCoordinate(order);
          if (!coords) return null;
          return {
            type: "Feature" as const,
            id: order.id,
            properties: {
              orderId: order.id,
              kind: "order",
              index: index + 1,
              color: statusColor(order.status),
            },
            geometry: { type: "Point" as const, coordinates: coords },
          };
        })
        .filter(Boolean),
    };
  }, [visibleMapOrders]);

  const driverHitCollection = useMemo(() => {
    return {
      type: "FeatureCollection" as const,
      features: visibleDrivers.map((driver) => ({
        type: "Feature" as const,
        id: driver.driver_id,
        properties: {
          driverId: driver.driver_id,
          kind: "driver",
          color: "#0284C7",
        },
        geometry: {
          type: "Point" as const,
          coordinates: [driver.lng, driver.lat] as [number, number],
        },
      })),
    };
  }, [visibleDrivers]);

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

  const headerStatusLabel = useMemo(() => {
    if (profileNeedsSetup) {
      return t("restaurant.home.status.setup", "SETUP");
    }
    if (restaurantBusy) {
      return windowWidth < 380
        ? t("restaurant.home.status.busyShort", "BUSY")
        : t("restaurant.home.status.busy", "OCCUPÉ");
    }
    if (!restaurantOnline) {
      return windowWidth < 380
        ? t("restaurant.home.status.offlineShort", "OFF")
        : t("restaurant.home.status.offline", "HORS LIGNE");
    }
    return windowWidth < 380
      ? t("restaurant.home.status.onlineShort", "ON")
      : t("restaurant.home.status.online", "EN LIGNE");
  }, [profileNeedsSetup, restaurantBusy, restaurantOnline, t, windowWidth]);

  const restaurantIdShort = useMemo(() => {
    const id = String(activeRestaurantId || "").trim();
    if (!id) return null;
    return `REST-${id.slice(0, 4).toUpperCase()}`;
  }, [activeRestaurantId]);

  const loadSidebarAd = useCallback(async () => {
    try {
      setSidebarAdLoading(true);
      const ads = await fetchClientAdvertisements({
        placement: "restaurant_sidebar",
        country: restaurantMarket.countryCode || null,
        language: null,
        limit: 1,
      });
      setSidebarAd(ads[0] ?? null);
    } catch (e) {
      console.warn("[restaurant.home.ads]", e);
      setSidebarAd(null);
    } finally {
      setSidebarAdLoading(false);
    }
  }, [restaurantMarket.countryCode]);

  useFocusEffect(
    useCallback(() => {
      void loadSidebarAd();
    }, [loadSidebarAd]),
  );

  const openStatusMenu = useCallback(() => {
    if (profileNeedsSetup) {
      navigation.navigate("RestaurantSetup");
      return;
    }
    Alert.alert(
      t("restaurant.home.status.title", "Statut du restaurant"),
      t(
        "restaurant.home.status.subtitle",
        "Choisissez comment recevoir les commandes.",
      ),
      [
        {
          text: t("restaurant.home.status.online", "EN LIGNE"),
          onPress: () => {
            if (!restaurantOnline || restaurantBusy) {
              void updateRestaurantAvailability(true);
            }
          },
        },
        {
          text: t("restaurant.dashboard.busyOff", "Mode occupé"),
          onPress: () => {
            if (!restaurantOnline) {
              Alert.alert(
                t("common.errorTitle", "Error"),
                t(
                  "restaurant.dashboard.busyRequiresOnline",
                  "Passez d’abord en ligne pour activer le mode occupé.",
                ),
              );
              return;
            }
            handleToggleBusy();
          },
        },
        {
          text: t("restaurant.home.status.offline", "HORS LIGNE"),
          style: "destructive",
          onPress: () => {
            if (restaurantOnline) {
              void updateRestaurantAvailability(false);
            }
          },
        },
        { text: t("common.cancel", "Cancel"), style: "cancel" },
      ],
    );
  }, [
    handleToggleBusy,
    navigation,
    profileNeedsSetup,
    restaurantBusy,
    restaurantOnline,
    t,
    updateRestaurantAvailability,
  ]);

  const openAccountMenu = useCallback(() => {
    Alert.alert(
      restaurantName,
      restaurantIdShort ? `ID: ${restaurantIdShort}` : undefined,
      [
        {
          text: t("restaurant.home.nav.settings", "Paramètres"),
          onPress: () => navigation.navigate("RestaurantOrderAutomation"),
        },
        {
          text: t("restaurant.home.account.setup", "Profil restaurant"),
          onPress: () => navigation.navigate("RestaurantSetup"),
        },
        {
          text: t("restaurant.home.nav.language", "Langue"),
          onPress: () => navigation.navigate("RestaurantLanguage"),
        },
        {
          text: t("restaurant.home.nav.security", "Sécurité"),
          onPress: () => navigation.navigate("RestaurantSecurity"),
        },
        { text: t("common.cancel", "Cancel"), style: "cancel" },
      ],
    );
  }, [navigation, restaurantIdShort, restaurantName, t]);

  const handleSidebarNavigate = useCallback(
    (key: RestaurantHomeNavKey) => {
      switch (key) {
        case "home":
          break;
        case "dashboard":
          navigation.navigate("RestaurantCommandCenter");
          break;
        case "orders":
          navigation.navigate("RestaurantOrders");
          break;
        case "menu":
          navigation.navigate("RestaurantMenu");
          break;
        case "drivers":
          setShowDrivers((v) => !v);
          break;
        case "stats":
          navigation.navigate("RestaurantEarnings");
          break;
        case "finance":
          navigation.navigate("RestaurantFinancialCenter");
          break;
        case "tax":
          navigation.navigate("RestaurantTax");
          break;
        case "security":
          navigation.navigate("RestaurantSecurity");
          break;
        case "settings":
          navigation.navigate("RestaurantOrderAutomation");
          break;
        case "language":
          navigation.navigate("RestaurantLanguage");
          break;
        case "heatmap":
          setShowHeatmap((v) => !v);
          break;
        case "dash":
          Alert.alert(
            t("restaurant.dashboard.title", "Restaurant Dashboard"),
            `${t("restaurant.dashboard.ordersToday", "Orders today")}: ${stats.ordersToday}\n` +
              `${t("restaurant.dashboard.revenueToday", "Revenue today")}: ${formatMoney(stats.revenueToday, stats.currency)}\n` +
              `${t("restaurant.dashboard.pendingOrders", "Pending orders")}: ${stats.pendingOrders}\n` +
              `${t("restaurant.dashboard.driversNearby", "Drivers nearby")}: ${visibleDrivers.length}\n` +
              `${t("restaurant.dashboard.surgeZone", "Surge zone")}: ${surgePoints.length > 0 ? t("common.yes", "Yes") : t("common.no", "No")}`,
          );
          break;
        case "ai":
          Alert.alert(
            t("restaurant.dashboard.aiDispatch", "AI Dispatch"),
            aiDispatchInsight,
          );
          break;
        default:
          break;
      }
    },
    [
      aiDispatchInsight,
      navigation,
      stats.currency,
      stats.ordersToday,
      stats.pendingOrders,
      stats.revenueToday,
      surgePoints.length,
      t,
      visibleDrivers.length,
    ],
  );

  const onSidebarAdAction = useCallback(
    (ad: ClientAdvertisement) => {
      resolveClientAdAction(ad.button_action, {
        taxi: () => {},
        food: () => navigation.navigate("RestaurantOrders"),
        delivery: () => navigation.navigate("RestaurantOrders"),
        marketplace: () => {},
        rewards: () => navigation.navigate("RestaurantFinancialCenter"),
        mmdPlus: () => navigation.navigate("RestaurantFinancialCenter"),
      });
      const raw = String(ad.button_action ?? "").trim();
      if (raw.startsWith("http://") || raw.startsWith("https://")) {
        void Linking.openURL(raw);
      }
    },
    [navigation],
  );

  if (checkingAuth) {
    return (
      <SafeAreaProvider>
        <View style={restaurantStyles.loadingSafe}>
          <StatusBar barStyle="dark-content" backgroundColor={RH.bg} translucent={false} />
          <ActivityIndicator color={RH.green} />
          <Text style={{ color: RH.text, marginTop: 10 }}>
            {t("common.loading", "Chargement…")}
          </Text>
        </View>
      </SafeAreaProvider>
    );
  }

  const onlineForHeader = !profileNeedsSetup && restaurantOnline && !restaurantBusy;

  return (
    <SafeAreaProvider>
      <View style={restaurantStyles.safe}>
        <StatusBar barStyle="dark-content" backgroundColor={RH.bg} translucent={false} />
        <View style={restaurantStyles.root}>
          <RestaurantHomeHeader
            restaurantName={restaurantName}
            restaurantIdShort={restaurantIdShort}
            logoUrl={restaurantLogoUrl}
            initials={avatarLetter}
            online={onlineForHeader}
            busy={restaurantBusy}
            availabilityLoading={availabilityLoading}
            notificationCount={stats.pendingOrders}
            compact={!isTabletLayout}
            onPressMenu={() => setDrawerOpen(true)}
            onPressStatus={openStatusMenu}
            onPressNotifications={() => navigation.navigate("RestaurantOrders")}
            onPressAccount={openAccountMenu}
            statusLabel={headerStatusLabel}
            brandTitle="MMD"
            brandSubtitle={t("restaurant.home.brandSubtitle", "RESTAURANT")}
          />

          <View style={restaurantStyles.body}>
            {isTabletLayout ? (
              <RestaurantHomeSidebar
                permanent
                open
                onClose={() => {}}
                activeKey="home"
                showDrivers={showDrivers}
                showHeatmap={showHeatmap}
                badges={{
                  pendingOrders: stats.pendingOrders,
                  ordersToday: stats.ordersToday,
                  drivers: visibleDrivers.length,
                }}
                ad={sidebarAd}
                adLoading={sidebarAdLoading}
                adCountry={restaurantMarket.countryCode || null}
                onAdAction={onSidebarAdAction}
                onNavigate={handleSidebarNavigate}
                t={(key, fallback) => t(key, fallback)}
              />
            ) : (
              <RestaurantHomeSidebar
                permanent={false}
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                activeKey="home"
                showDrivers={showDrivers}
                showHeatmap={showHeatmap}
                badges={{
                  pendingOrders: stats.pendingOrders,
                  ordersToday: stats.ordersToday,
                  drivers: visibleDrivers.length,
                }}
                ad={sidebarAd}
                adLoading={sidebarAdLoading}
                adCountry={restaurantMarket.countryCode || null}
                onAdAction={onSidebarAdAction}
                onNavigate={handleSidebarNavigate}
                t={(key, fallback) => t(key, fallback)}
              />
            )}

            <View style={restaurantStyles.mapPane}>
              <Mapbox.MapView
                style={restaurantStyles.map}
                styleURL={mapStyleURL || getMapStyleStreets()}
                logoEnabled={false}
                attributionEnabled={false}
                compassEnabled={false}
                scaleBarEnabled={false}
                rotateEnabled
                pitchEnabled={false}
                scrollEnabled
                zoomEnabled
                surfaceView={Platform.OS === "android" ? false : undefined}
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

                <Mapbox.ShapeSource
                  id="restaurant-home-hit"
                  shape={{
                    type: "FeatureCollection",
                    features: [
                      {
                        type: "Feature",
                        id: "restaurant-home",
                        properties: { kind: "restaurant" },
                        geometry: {
                          type: "Point",
                          coordinates: restaurantCoordinate,
                        },
                      },
                    ],
                  }}
                  hitbox={{ width: 72, height: 72 }}
                  onPress={() =>
                    setMapSelection({
                      kind: "restaurant",
                      id: activeRestaurantId || "restaurant",
                      name: restaurantName,
                    })
                  }
                >
                  <Mapbox.CircleLayer
                    id="restaurant-home-hit-layer"
                    style={{
                      circleRadius: 26,
                      circleColor: "#EAB308",
                      circleOpacity: 0.001,
                    }}
                  />
                </Mapbox.ShapeSource>

                <Mapbox.MarkerView
                  id="restaurant-home-pin"
                  coordinate={restaurantCoordinate}
                  anchor={{ x: 0.5, y: 1 }}
                  allowOverlap
                >
                  <View pointerEvents="none">
                    <RestaurantMapPin label={avatarLetter} />
                  </View>
                </Mapbox.MarkerView>

                {orderHitCollection.features.length > 0 ? (
                  <Mapbox.ShapeSource
                    id="restaurant-orders-interactive"
                    shape={orderHitCollection}
                    hitbox={{ width: 64, height: 64 }}
                    onPress={(event) => {
                      const feature = event?.features?.[0] as
                        | { properties?: { orderId?: string } }
                        | undefined;
                      const orderId = String(feature?.properties?.orderId ?? "");
                      const order = visibleMapOrders.find((row) => row.id === orderId);
                      if (order) handleOpenMapOrder(order);
                    }}
                  >
                    <Mapbox.CircleLayer
                      id="restaurant-orders-halo"
                      style={{
                        circleRadius: 22,
                        circleColor: ["get", "color"] as any,
                        circleOpacity: 0.22,
                        circleBlur: 0.55,
                      }}
                    />
                    <Mapbox.CircleLayer
                      id="restaurant-orders-dot"
                      style={{
                        circleRadius: 13,
                        circleColor: ["get", "color"] as any,
                        circleOpacity: 1,
                        circleStrokeWidth: 3,
                        circleStrokeColor: "#FFFFFF",
                      }}
                    />
                  </Mapbox.ShapeSource>
                ) : null}

                {showDrivers && driverHitCollection.features.length > 0 ? (
                  <Mapbox.ShapeSource
                    id="restaurant-drivers-interactive"
                    shape={driverHitCollection}
                    hitbox={{ width: 64, height: 64 }}
                    onPress={(event) => {
                      const feature = event?.features?.[0] as
                        | { properties?: { driverId?: string } }
                        | undefined;
                      const driverId = String(feature?.properties?.driverId ?? "");
                      const driver = visibleDrivers.find((row) => row.driver_id === driverId);
                      if (driver) handleOpenMapDriver(driver);
                    }}
                  >
                    <Mapbox.CircleLayer
                      id="restaurant-drivers-halo"
                      style={{
                        circleRadius: 20,
                        circleColor: "#0284C7",
                        circleOpacity: 0.22,
                        circleBlur: 0.5,
                      }}
                    />
                    <Mapbox.CircleLayer
                      id="restaurant-drivers-dot"
                      style={{
                        circleRadius: 12,
                        circleColor: "#0284C7",
                        circleOpacity: 1,
                        circleStrokeWidth: 3,
                        circleStrokeColor: "#FFFFFF",
                      }}
                    />
                  </Mapbox.ShapeSource>
                ) : null}
              </Mapbox.MapView>

              <View style={restaurantStyles.marketWrap} pointerEvents="none">
                <MarketScopePill market={restaurantMarket} />
              </View>

              <RestaurantHomeMapChrome
                statusFilter={statusFilter}
                onChangeStatusFilter={setStatusFilter}
                selection={mapSelection}
                onCloseSelection={() => setMapSelection(null)}
                onOpenSelection={
                  mapSelection?.kind === "order"
                    ? () => openRestaurantOrderDetails(mapSelection.id)
                    : undefined
                }
                onZoomIn={() => setZoomLevel((value) => Math.min(16, value + 0.6))}
                onZoomOut={() => setZoomLevel((value) => Math.max(10, value - 0.6))}
                onRecenter={() => {
                  setZoomLevel((value) => (value === 13 ? 13.01 : 13));
                  cameraRef.current?.setCamera({
                    centerCoordinate: restaurantCoordinate,
                    zoomLevel: 13,
                    animationMode: "flyTo",
                    animationDuration: 650,
                  });
                }}
                onToggleLayers={() =>
                  setMapStyleURL((value) =>
                    value === getMapStyleStreets() ? getMapStyleDark() : getMapStyleStreets(),
                  )
                }
                onRefresh={refreshLiveMap}
                layersActive={mapStyleURL === getMapStyleDark()}
                refreshing={statsLoading}
                formatMoney={(amount) => formatMoney(Number(amount ?? 0), stats.currency)}
                statusLabel={statusLabel}
                t={(key, fallback) => t(key, fallback)}
              />

              {profileNeedsSetup && (
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => navigation.navigate("RestaurantSetup")}
                  style={restaurantStyles.setupBanner}
                >
                  <Text
                    numberOfLines={1}
                    style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "900" }}
                  >
                    {t("restaurant.dashboard.setupRequiredTitle", "Profil incomplet")}
                  </Text>
                  <Text
                    numberOfLines={2}
                    style={{
                      color: "#FECACA",
                      fontSize: 10.5,
                      fontWeight: "700",
                      marginTop: 3,
                      lineHeight: 14,
                    }}
                  >
                    {t(
                      "restaurant.dashboard.setupRequiredBody",
                      "Complète le nom, l’adresse et les coordonnées GPS du restaurant avant de passer en ligne.",
                    )}
                  </Text>
                </TouchableOpacity>
              )}

              {liveOrder && (
                <Animated.View
                  style={[
                    restaurantStyles.liveOrderCard,
                    {
                      opacity: liveOrderAnim,
                      transform: [
                        {
                          translateY: liveOrderAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [-16, 0],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={{ color: "#C2410C", fontSize: 12, fontWeight: "900" }}>
                        {t("restaurant.dashboard.newFoodOrder", "New food order")}
                      </Text>
                      <Text
                        style={{
                          color: RH.text,
                          fontSize: 18,
                          fontWeight: "900",
                          marginTop: 3,
                        }}
                      >
                        #{liveOrder.id.slice(0, 8)} ·{" "}
                        {formatMoney(Number(liveOrder.total ?? 0), stats.currency)}
                      </Text>
                      <Text
                        style={{
                          color: RH.textSecondary,
                          fontSize: 11,
                          fontWeight: "700",
                          marginTop: 3,
                        }}
                      >
                        {statusLabel(liveOrder.status)} ·{" "}
                        {liveOrder.created_at
                          ? new Date(liveOrder.created_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "Live"}
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
                        backgroundColor: RH.muted,
                      }}
                    >
                      <Ionicons name="close" size={18} color={RH.textSecondary} />
                    </TouchableOpacity>
                  </View>

                  <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                    <TouchableOpacity
                      activeOpacity={0.88}
                      disabled={orderActionLoading}
                      onPress={handleRejectLiveOrder}
                      style={{
                        flex: 1,
                        minHeight: 44,
                        borderRadius: 999,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: RH.dangerSoft,
                        opacity: orderActionLoading ? 0.65 : 1,
                      }}
                    >
                      <Text style={{ color: RH.danger, fontSize: 12, fontWeight: "900" }}>
                        {t("common.reject", "Reject")}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      activeOpacity={0.88}
                      onPress={() => openRestaurantOrderDetails(liveOrder.id)}
                      style={{
                        flex: 1,
                        minHeight: 44,
                        borderRadius: 999,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: RH.muted,
                      }}
                    >
                      <Text style={{ color: RH.text, fontSize: 12, fontWeight: "900" }}>
                        {t("common.view", "View")}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      activeOpacity={0.88}
                      disabled={orderActionLoading}
                      onPress={handleAcceptLiveOrder}
                      style={{
                        flex: 1,
                        minHeight: 44,
                        borderRadius: 999,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: RH.green,
                        opacity: orderActionLoading ? 0.65 : 1,
                      }}
                    >
                      <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "900" }}>
                        {orderActionLoading ? "..." : t("common.accept", "Accept")}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </Animated.View>
              )}
            </View>
          </View>
        </View>
      </View>
    </SafeAreaProvider>
  );
}


export default RestaurantHomeScreen;
