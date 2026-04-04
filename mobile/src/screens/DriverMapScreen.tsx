import React, { useEffect, useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  PanResponder,
  Dimensions,
  ScrollView,
} from "react-native";
import MapView, { Marker, Polygon } from "react-native-maps";
import type { Region } from "react-native-maps";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import * as Location from "expo-location";
import { useTranslation } from "react-i18next";
import {
  startDriverLocationTracking,
  stopDriverLocationTracking,
} from "../lib/location";
import {
  getDriverOnlineStatus,
  setDriverOnlineStatus,
} from "../lib/driverStatus";
import { supabase } from "../lib/supabase";

type Nav = NativeStackNavigationProp<RootStackParamList, "DriverMap">;

const SCREEN_HEIGHT = Dimensions.get("window").height;

// Position du panneau (en px depuis le haut de l’écran)
const SHEET_EXPANDED_TOP = SCREEN_HEIGHT - 420;
const SHEET_COLLAPSED_TOP = SCREEN_HEIGHT - 140;

const IS_DEV = typeof __DEV__ !== "undefined" ? __DEV__ : false;

// ----------------------
// Types commandes
// ----------------------
type OrderStatus =
  | "pending"
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
};

// ----------------------
// Types & données zones
// ----------------------

type ZoneActivity = "calm" | "normal" | "busy" | "very_busy";

type DriverZone = {
  id: string;
  name: string;
  center: { lat: number; lng: number };
  radiusMeters: number;
  activity: ZoneActivity;
  polygon: { latitude: number; longitude: number }[];
};

// Restaurants à afficher sur la carte
type RestaurantPin = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
};

// Bannière course entrante
type IncomingOrderBanner = {
  id: string;
  restaurantName: string;
  pickupAddress: string;
  dropoffAddress: string;
  price: number;
  distanceMiles: number;
  etaMinutes: number;
  surgeLabel?: string | null;
};

const DRIVER_ZONES: DriverZone[] = [
  {
    id: "brooklyn",
    name: "Brooklyn",
    center: { lat: 40.650002, lng: -73.949997 },
    radiusMeters: 7000,
    activity: "busy",
    polygon: [
      { latitude: 40.705, longitude: -74.05 },
      { latitude: 40.74, longitude: -73.99 },
      { latitude: 40.73, longitude: -73.9 },
      { latitude: 40.67, longitude: -73.86 },
      { latitude: 40.6, longitude: -73.88 },
      { latitude: 40.58, longitude: -73.96 },
      { latitude: 40.6, longitude: -74.02 },
    ],
  },
  {
    id: "queens",
    name: "Queens",
    center: { lat: 40.7291, lng: -73.857 },
    radiusMeters: 9000,
    activity: "normal",
    polygon: [
      { latitude: 40.77, longitude: -73.96 },
      { latitude: 40.8, longitude: -73.86 },
      { latitude: 40.77, longitude: -73.77 },
      { latitude: 40.7, longitude: -73.73 },
      { latitude: 40.66, longitude: -73.8 },
      { latitude: 40.68, longitude: -73.9 },
    ],
  },
  {
    id: "manhattan",
    name: "Manhattan",
    center: { lat: 40.758, lng: -73.9855 },
    radiusMeters: 6000,
    activity: "busy",
    polygon: [
      { latitude: 40.88, longitude: -73.94 },
      { latitude: 40.87, longitude: -73.93 },
      { latitude: 40.71, longitude: -74.02 },
      { latitude: 40.7, longitude: -74.01 },
      { latitude: 40.7, longitude: -73.97 },
      { latitude: 40.88, longitude: -73.91 },
    ],
  },
  {
    id: "bronx",
    name: "Bronx",
    center: { lat: 40.8448, lng: -73.8648 },
    radiusMeters: 8000,
    activity: "calm",
    polygon: [
      { latitude: 40.93, longitude: -73.93 },
      { latitude: 40.91, longitude: -73.85 },
      { latitude: 40.88, longitude: -73.8 },
      { latitude: 40.83, longitude: -73.8 },
      { latitude: 40.8, longitude: -73.92 },
    ],
  },
  {
    id: "jersey_city",
    name: "Jersey City",
    center: { lat: 40.7178, lng: -74.0431 },
    radiusMeters: 5000,
    activity: "normal",
    polygon: [
      { latitude: 40.75, longitude: -74.11 },
      { latitude: 40.75, longitude: -74.03 },
      { latitude: 40.7, longitude: -74.03 },
      { latitude: 40.69, longitude: -74.09 },
    ],
  },
  {
    id: "staten_island",
    name: "Staten Island",
    center: { lat: 40.5795, lng: -74.1502 },
    radiusMeters: 9000,
    activity: "calm",
    polygon: [
      { latitude: 40.63, longitude: -74.26 },
      { latitude: 40.64, longitude: -74.16 },
      { latitude: 40.6, longitude: -74.07 },
      { latitude: 40.54, longitude: -74.06 },
      { latitude: 40.51, longitude: -74.18 },
    ],
  },
  {
    id: "newark",
    name: "Newark",
    center: { lat: 40.7357, lng: -74.1724 },
    radiusMeters: 6000,
    activity: "busy",
    polygon: [
      { latitude: 40.76, longitude: -74.23 },
      { latitude: 40.76, longitude: -74.15 },
      { latitude: 40.71, longitude: -74.13 },
      { latitude: 40.7, longitude: -74.2 },
    ],
  },
  {
    id: "downtown_bk",
    name: "Centre-ville BK",
    center: { lat: 40.6928, lng: -73.9903 },
    radiusMeters: 3500,
    activity: "very_busy",
    polygon: [
      { latitude: 40.7, longitude: -74.01 },
      { latitude: 40.7, longitude: -73.97 },
      { latitude: 40.68, longitude: -73.97 },
      { latitude: 40.68, longitude: -74.0 },
    ],
  },
];

// style dark map
const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#1F2937" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9CA3AF" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#111827" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#111827" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#374151" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#020617" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#020617" }] },
  { featureType: "transit", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
];

function getZoneColors(activity: ZoneActivity) {
  switch (activity) {
    case "very_busy":
      return {
        strokeColor: "rgba(220,38,38,0.9)",
        fillColor: "rgba(248,113,113,0.30)",
        labelColor: "#EF4444",
      };
    case "busy":
      return {
        strokeColor: "rgba(234,88,12,0.9)",
        fillColor: "rgba(251,146,60,0.30)",
        labelColor: "#F97316",
      };
    case "normal":
      return {
        strokeColor: "rgba(202,138,4,0.9)",
        fillColor: "rgba(250,204,21,0.28)",
        labelColor: "#EAB308",
      };
    case "calm":
    default:
      return {
        strokeColor: "rgba(22,163,74,0.9)",
        fillColor: "rgba(34,197,94,0.22)",
        labelColor: "#22C55E",
      };
  }
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function DriverMapScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useTranslation();

  const [region, setRegion] = useState<Region>({
    latitude: 40.73061,
    longitude: -73.935242,
    latitudeDelta: 0.06,
    longitudeDelta: 0.06,
  });
  const [hasLocation, setHasLocation] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [isOnline, setIsOnline] = useState(false);

  const [restaurants, setRestaurants] = useState<RestaurantPin[]>([]);
  const [restaurantsLoading, setRestaurantsLoading] = useState(false);

  const [currentZone, setCurrentZone] = useState<DriverZone | null>(null);

  const [driverId, setDriverId] = useState<string | null>(null);

  const [driverOrders, setDriverOrders] = useState<DriverOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  const [incomingOrder, setIncomingOrder] = useState<IncomingOrderBanner | null>(null);
  const [incomingTimer, setIncomingTimer] = useState(0);

  const [isNightMode, setIsNightMode] = useState(false);

  const mapRef = useRef<MapView | null>(null);

  const sheetTop = useRef(new Animated.Value(SHEET_COLLAPSED_TOP)).current;
  const sheetState = useRef<"collapsed" | "expanded">("collapsed");

  const animateSheet = (target: "collapsed" | "expanded") => {
    const toValue = target === "collapsed" ? SHEET_COLLAPSED_TOP : SHEET_EXPANDED_TOP;
    sheetState.current = target;

    Animated.spring(sheetTop, {
      toValue,
      useNativeDriver: false,
      tension: 40,
      friction: 10,
    }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 10,
      onPanResponderMove: (_, gestureState) => {
        const currentTop =
          sheetState.current === "collapsed" ? SHEET_COLLAPSED_TOP : SHEET_EXPANDED_TOP;

        let newTop = currentTop + gestureState.dy;
        newTop = Math.max(SHEET_EXPANDED_TOP, Math.min(SHEET_COLLAPSED_TOP, newTop));
        sheetTop.setValue(newTop);
      },
      onPanResponderRelease: (_, gestureState) => {
        const shouldExpand = gestureState.dy < 0;
        animateSheet(shouldExpand ? "expanded" : "collapsed");
      },
    })
  ).current;

  // INIT GPS
  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;

    async function init() {
      try {
        setLoading(true);
        setErrorMsg(null);

        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          setErrorMsg(t("driver.map.permissionDenied"));
          setLoading(false);
          return;
        }

        const current = await Location.getCurrentPositionAsync({});
        if (cancelled) return;

        setRegion((prev) => ({
          ...prev,
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
          latitudeDelta: 0.04,
          longitudeDelta: 0.04,
        }));
        setHasLocation(true);
        setLoading(false);

        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 5000,
            distanceInterval: 15,
          },
          (pos) => {
            if (cancelled) return;
            const { latitude, longitude } = pos.coords;
            setRegion((prev) => ({ ...prev, latitude, longitude }));
            setHasLocation(true);
          }
        );
      } catch (e: any) {
        console.log("Erreur DriverMapScreen:", e);
        if (!cancelled) {
          setErrorMsg(e?.message ?? t("driver.map.permissionDenied"));
          setLoading(false);
        }
      }
    }

    void init();

    return () => {
      cancelled = true;
      if (subscription) subscription.remove();
      stopDriverLocationTracking();
    };
  }, [t]);

  // Relire statut sauvegardé
  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      const savedOnline = await getDriverOnlineStatus();
      if (cancelled) return;

      setIsOnline(!!savedOnline);

      if (savedOnline) {
        await startDriverLocationTracking({ intervalMs: 2000 });
      }
    }

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  // driverId
  useEffect(() => {
    let cancelled = false;

    async function loadDriver() {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error || !data?.user) {
          console.log("🚫 Impossible de récupérer l'utilisateur (driver)", error);
          return;
        }
        if (!cancelled) setDriverId(data.user.id);
      } catch (e) {
        console.log("Erreur loadDriver:", e);
      }
    }

    void loadDriver();
    return () => {
      cancelled = true;
    };
  }, []);

  // commandes assignées
  useEffect(() => {
    if (!driverId) return;

    let cancelled = false;

    async function fetchDriverOrders() {
      try {
        setOrdersLoading(true);
        setOrdersError(null);

        const { data: memberships, error: membershipError } = await supabase
          .from("order_members")
          .select("order_id")
          .eq("user_id", driverId)
          .eq("role", "driver");

        if (membershipError) throw membershipError;

        const orderIds = (memberships ?? []).map((m: any) => m.order_id).filter(Boolean);

        if (orderIds.length === 0) {
          if (!cancelled) setDriverOrders([]);
          return;
        }

        const { data: ordersData, error: ordersError } = await supabase
          .from("orders")
          .select(
            `
            id,
            kind,
            status,
            created_at,
            restaurant_name,
            pickup_address,
            dropoff_address,
            distance_miles,
            delivery_fee,
            driver_delivery_payout,
            total
          `
          )
          .in("id", orderIds)
          .order("created_at", { ascending: false });

        if (ordersError) throw ordersError;

        if (!cancelled) setDriverOrders((ordersData as any as DriverOrder[]) ?? []);
      } catch (e: any) {
        console.log("Erreur chargement commandes driver (map):", e);
        if (!cancelled) setOrdersError(e?.message ?? t("driver.map.myOrders.loading"));
      } finally {
        if (!cancelled) setOrdersLoading(false);
      }
    }

    void fetchDriverOrders();
    return () => {
      cancelled = true;
    };
  }, [driverId, t]);

  // restaurants approuvés
  useEffect(() => {
    if (!hasLocation) return;

    let cancelled = false;

    async function loadRestaurants() {
      try {
        setRestaurantsLoading(true);

        const { data, error } = await supabase
          .from("restaurant_profiles")
          .select("user_id, restaurant_name, location_lat, location_lng, status")
          .eq("status", "approved")
          .limit(150);

        if (error) {
          console.log("Erreur chargement restaurants:", error);
          setRestaurants([]);
          return;
        }

        if (!data || cancelled) return;

        const mapped: RestaurantPin[] = (data as any[])
          .filter((row) => row.location_lat != null && row.location_lng != null)
          .map((row) => ({
            id: row.user_id,
            name: row.restaurant_name ?? "Restaurant",
            latitude: row.location_lat,
            longitude: row.location_lng,
          }));

        setRestaurants(mapped);
      } catch (e) {
        console.log("Exception loadRestaurants:", e);
        setRestaurants([]);
      } finally {
        if (!cancelled) setRestaurantsLoading(false);
      }
    }

    void loadRestaurants();
    return () => {
      cancelled = true;
    };
  }, [hasLocation]);

  // zone courante
  useEffect(() => {
    if (!hasLocation) {
      setCurrentZone(null);
      return;
    }

    let bestZone: DriverZone | null = null;
    let bestDist = Infinity;

    for (const zone of DRIVER_ZONES) {
      const d = distanceMeters(region.latitude, region.longitude, zone.center.lat, zone.center.lng);
      if (d < zone.radiusMeters && d < bestDist) {
        bestDist = d;
        bestZone = zone;
      }
    }

    setCurrentZone(bestZone);
  }, [region.latitude, region.longitude, hasLocation]);

  // dark mode auto
  useEffect(() => {
    const now = new Date();
    const hour = now.getHours();
    setIsNightMode(hour >= 19 || hour < 6);
  }, []);

  // timer bannière
  useEffect(() => {
    if (!incomingOrder) return;

    if (incomingTimer <= 0) {
      handleRejectIncomingOrder("timeout");
      return;
    }

    const id = setTimeout(() => setIncomingTimer((ti) => ti - 1), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingOrder, incomingTimer]);

  // realtime offers
  useEffect(() => {
    if (!driverId || !isOnline) return;

    const channel = supabase
      .channel(`driver-offers-${driverId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "driver_order_offers",
          filter: `driver_id=eq.${driverId}`,
        },
        (payload) => {
          const row: any = payload.new;

          const price = row.driver_price_cents != null ? row.driver_price_cents / 100 : 0;

          const banner: IncomingOrderBanner = {
            id: row.order_id ?? row.id ?? "unknown-order",
            restaurantName: row.restaurant_name ?? "Restaurant",
            pickupAddress: row.pickup_address ?? "—",
            dropoffAddress: row.dropoff_address ?? "—",
            price,
            distanceMiles: Number(row.distance_miles ?? 0),
            etaMinutes: row.eta_minutes ?? 0,
            surgeLabel: row.surge_label ?? null,
          };

          setIncomingOrder(banner);
          setIncomingTimer(60);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [driverId, isOnline]);

  async function handleToggleOnline() {
    try {
      if (!isOnline) {
        setIsOnline(true);
        await setDriverOnlineStatus(true);
        await startDriverLocationTracking({ intervalMs: 2000 });
      } else {
        setIsOnline(false);
        await setDriverOnlineStatus(false);
        stopDriverLocationTracking();
      }
    } catch (e) {
      console.log("Erreur toggle online:", e);
    }
  }

  function centerOnDriver() {
    if (!hasLocation || !mapRef.current) return;

    mapRef.current.animateToRegion(
      {
        latitude: region.latitude,
        longitude: region.longitude,
        latitudeDelta: 0.04,
        longitudeDelta: 0.04,
      },
      400
    );
  }

  function handleAcceptIncomingOrder() {
    if (!incomingOrder) return;
    setIncomingOrder(null);
    setIncomingTimer(0);
  }

  function handleRejectIncomingOrder(_reason: "reject" | "timeout") {
    if (!incomingOrder) return;
    setIncomingOrder(null);
    setIncomingTimer(0);
  }

  function triggerTestIncomingOrder() {
    const surgeLabel =
      currentZone && (currentZone.activity === "busy" || currentZone.activity === "very_busy")
        ? currentZone.activity === "very_busy"
          ? "x1.6"
          : "x1.3"
        : null;

    const fakeOrder: IncomingOrderBanner = {
      id: "test-order",
      restaurantName: "Restaurant MMD test",
      pickupAddress: "Prospect Park West, Brooklyn",
      dropoffAddress: "Flatbush Ave, Brooklyn",
      price: 14.5,
      distanceMiles: 3.7,
      etaMinutes: 12,
      surgeLabel,
    };

    setIncomingOrder(fakeOrder);
    setIncomingTimer(60);
  }

  function handleOpenOrder(orderId: string) {
    navigation.navigate("DriverOrderDetails", { orderId });
  }

  const statusTitle = isOnline ? t("driver.map.online") : t("driver.map.offline");

  const statusSubtitle = isOnline
    ? t("driver.map.statusOnlineSubtitle")
    : hasLocation
    ? t("driver.map.statusOfflineSubtitleHasLocation")
    : t("driver.map.statusOfflineSubtitleNoLocation");

  const boostMultiplier =
    currentZone?.activity === "very_busy" ? 1.6 : currentZone?.activity === "busy" ? 1.3 : 1.0;

  const boostLabelGlobal = boostMultiplier > 1 ? `x${boostMultiplier.toFixed(1)}` : null;

  function formatDate(iso: string | null) {
    if (!iso) return "—";
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  function formatStatus(status: OrderStatus) {
    switch (status) {
      case "pending":
        return t("driver.map.status.pending");
      case "accepted":
        return t("driver.map.status.accepted");
      case "prepared":
        return t("driver.map.status.prepared");
      case "ready":
        return t("driver.map.status.ready");
      case "dispatched":
        return t("driver.map.status.dispatched");
      case "delivered":
        return t("driver.map.status.delivered");
      case "canceled":
        return t("driver.map.status.canceled");
      default:
        return status;
    }
  }

  function formatKind(kind: OrderKind, restaurantName: string | null) {
    if (kind === "food") {
      return restaurantName
        ? t("driver.map.kind.foodWithName", { name: restaurantName })
        : t("driver.map.kind.food");
    }
    if (kind === "pickup_dropoff") return t("driver.map.kind.pickup_dropoff");
    return kind;
  }

  function getActivityLabel(activity: ZoneActivity) {
    switch (activity) {
      case "very_busy":
        return t("driver.map.activity.very_busy");
      case "busy":
        return t("driver.map.activity.busy");
      case "normal":
        return t("driver.map.activity.normal");
      case "calm":
      default:
        return t("driver.map.activity.calm");
    }
  }

  function renderOrderCard(order: DriverOrder) {
    const gain = order.driver_delivery_payout ?? order.delivery_fee ?? order.total;

    return (
      <TouchableOpacity
        key={order.id}
        onPress={() => handleOpenOrder(order.id)}
        style={{
          backgroundColor: "#020617",
          borderRadius: 12,
          borderWidth: 1,
          borderColor: "#1F2937",
          padding: 8,
          marginBottom: 6,
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 2 }}>
          <Text style={{ color: "#E5E7EB", fontSize: 12, fontWeight: "600" }}>
            #{order.id.slice(0, 8)}
          </Text>
          <Text
            style={{
              color:
                order.status === "delivered"
                  ? "#22C55E"
                  : order.status === "dispatched"
                  ? "#FBBF24"
                  : "#93C5FD",
              fontSize: 11,
              fontWeight: "600",
            }}
          >
            {formatStatus(order.status)}
          </Text>
        </View>

        <Text style={{ color: "#93C5FD", fontSize: 11, marginBottom: 2 }}>
          {formatKind(order.kind, order.restaurant_name)}
        </Text>

        <Text style={{ color: "#6B7280", fontSize: 10, marginBottom: 4 }}>
          {formatDate(order.created_at)}
        </Text>

        <Text style={{ color: "#9CA3AF", fontSize: 11 }} numberOfLines={1}>
          {t("driver.map.orderCard.pickupLabel")}{" "}
          <Text style={{ color: "#E5E7EB", fontWeight: "500" }}>
            {order.pickup_address ?? "—"}
          </Text>
        </Text>

        <Text style={{ color: "#9CA3AF", fontSize: 11, marginBottom: 2 }} numberOfLines={1}>
          {t("driver.map.orderCard.dropoffLabel")}{" "}
          <Text style={{ color: "#E5E7EB", fontWeight: "500" }}>
            {order.dropoff_address ?? "—"}
          </Text>
        </Text>

        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
          <Text style={{ color: "#9CA3AF", fontSize: 10 }}>
            {t("driver.map.orderCard.distanceLabel")}{" "}
            <Text style={{ color: "#E5E7EB", fontWeight: "600" }}>
              {order.distance_miles != null ? `${order.distance_miles.toFixed(2)} mi` : "—"}
            </Text>
          </Text>

          <Text style={{ color: "#9CA3AF", fontSize: 10 }}>
            {t("driver.map.orderCard.earningsLabel")}{" "}
            <Text style={{ color: "#E5E7EB", fontWeight: "700" }}>
              {gain != null ? `${gain.toFixed(2)} USD` : "—"}
            </Text>
          </Text>
        </View>

        <Text style={{ marginTop: 4, color: "#3B82F6", fontSize: 11, fontWeight: "600", textAlign: "right" }}>
          {t("driver.map.myOrders.viewDetails")}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />

      {/* HEADER */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: 8,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: "#4B5563",
          }}
        >
          <Text style={{ color: "#E5E7EB", fontSize: 13 }}>
            {t("common.back", "← Retour")}
          </Text>
        </TouchableOpacity>

        <Text style={{ color: "white", fontSize: 16, fontWeight: "700" }}>
          {t("driver.map.headerTitle")}
        </Text>

        <TouchableOpacity
          onPress={handleToggleOnline}
          activeOpacity={0.9}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: isOnline ? "#22C55E" : "#F97373",
            backgroundColor: "rgba(15,23,42,0.9)",
            minWidth: 92,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: isOnline ? "#86EFAC" : "#FECACA",
              fontSize: 11,
              fontWeight: "800",
              letterSpacing: 0.5,
            }}
          >
            {isOnline ? t("driver.map.online") : t("driver.map.offline")}
          </Text>
        </TouchableOpacity>
      </View>

      {/* CARTE + UI */}
      <View style={{ flex: 1 }}>
        {loading && !hasLocation ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator />
            <Text style={{ color: "#9CA3AF", fontSize: 12, marginTop: 8 }}>
              {t("driver.map.locating")}
            </Text>
          </View>
        ) : (
          <>
            <MapView
              ref={mapRef}
              style={{ flex: 1 }}
              region={region}
              onRegionChangeComplete={(r) => setRegion(r)}
              customMapStyle={isNightMode ? DARK_MAP_STYLE : []}
            >
              {hasLocation && (
                <Marker coordinate={{ latitude: region.latitude, longitude: region.longitude }}>
                  <View
                    style={{
                      height: 28,
                      width: 28,
                      borderRadius: 14,
                      backgroundColor: "#22C55E",
                      borderWidth: 2,
                      borderColor: "#FFFFFF",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ color: "white", fontSize: 10, fontWeight: "700" }}>D</Text>
                  </View>
                </Marker>
              )}

              {DRIVER_ZONES.map((zone) => {
                const { strokeColor, fillColor, labelColor } = getZoneColors(zone.activity);
                return (
                  <React.Fragment key={zone.id}>
                    <Polygon coordinates={zone.polygon} strokeColor={strokeColor} strokeWidth={2} fillColor={fillColor} />
                    <Marker coordinate={{ latitude: zone.center.lat, longitude: zone.center.lng }}>
                      <View
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 4,
                          borderRadius: 999,
                          backgroundColor: "rgba(15,23,42,0.95)",
                          borderWidth: 1,
                          borderColor: "rgba(148,163,184,0.8)",
                        }}
                      >
                        <Text style={{ color: "#F9FAFB", fontSize: 11, fontWeight: "600" }}>
                          {zone.name}
                        </Text>
                        <Text style={{ color: labelColor, fontSize: 10, marginTop: 1 }}>
                          {getActivityLabel(zone.activity)}
                        </Text>
                      </View>
                    </Marker>
                  </React.Fragment>
                );
              })}

              {restaurants.map((resto) => {
                const dist = hasLocation
                  ? distanceMeters(region.latitude, region.longitude, resto.latitude, resto.longitude)
                  : Infinity;

                const inBusyZone =
                  currentZone && (currentZone.activity === "busy" || currentZone.activity === "very_busy");

                const isClose = dist < 2500;
                const isBoosted = inBusyZone && isClose;

                const boostLabel =
                  isBoosted && currentZone
                    ? currentZone.activity === "very_busy"
                      ? "x1.6"
                      : "x1.3"
                    : null;

                return (
                  <Marker key={resto.id} coordinate={{ latitude: resto.latitude, longitude: resto.longitude }}>
                    <View
                      style={{
                        paddingHorizontal: 6,
                        paddingVertical: 4,
                        borderRadius: 999,
                        backgroundColor: "#FFF",
                        borderWidth: 1.5,
                        borderColor: isBoosted ? "#EA580C" : "#F97316",
                        flexDirection: "row",
                        alignItems: "center",
                        shadowColor: "#000",
                        shadowOpacity: isBoosted ? 0.35 : 0.2,
                        shadowRadius: isBoosted ? 10 : 6,
                        shadowOffset: { width: 0, height: 3 },
                      }}
                    >
                      <View
                        style={{
                          width: isBoosted ? 18 : 16,
                          height: isBoosted ? 18 : 16,
                          borderRadius: 9,
                          backgroundColor: isBoosted ? "#EA580C" : "#F97316",
                          alignItems: "center",
                          justifyContent: "center",
                          marginRight: 4,
                        }}
                      >
                        <Text style={{ color: "#FFF", fontSize: 10, fontWeight: "700" }}>
                          {isBoosted ? "🔥" : "R"}
                        </Text>
                      </View>
                      <Text
                        style={{ color: "#111827", fontSize: 10, maxWidth: 90, fontWeight: isBoosted ? "600" : "500" }}
                        numberOfLines={1}
                      >
                        {resto.name}
                      </Text>
                      {boostLabel && (
                        <View
                          style={{
                            marginLeft: 4,
                            paddingHorizontal: 4,
                            paddingVertical: 1,
                            borderRadius: 999,
                            backgroundColor: "#FEF3C7",
                          }}
                        >
                          <Text style={{ color: "#B45309", fontSize: 9, fontWeight: "700" }}>{boostLabel}</Text>
                        </View>
                      )}
                    </View>
                  </Marker>
                );
              })}
            </MapView>

            {incomingOrder && (
              <View
                style={{
                  position: "absolute",
                  left: 12,
                  right: 12,
                  top: 52,
                  padding: 10,
                  borderRadius: 16,
                  backgroundColor: "rgba(15,23,42,0.98)",
                  borderWidth: 1,
                  borderColor: "#F97316",
                  shadowColor: "#000",
                  shadowOpacity: 0.45,
                  shadowRadius: 18,
                  shadowOffset: { width: 0, height: 6 },
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <Text style={{ color: "#F9FAFB", fontSize: 13, fontWeight: "700" }}>
                    {t("driver.map.incoming.title")}
                  </Text>
                  <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: "#111827", borderWidth: 1, borderColor: "#F97316" }}>
                    <Text style={{ color: "#F97316", fontSize: 11, fontWeight: "700" }}>
                      {incomingTimer}s
                    </Text>
                  </View>
                </View>

                <Text style={{ color: "#E5E7EB", fontSize: 12, marginBottom: 2 }}>
                  {incomingOrder.restaurantName}
                </Text>
                <Text style={{ color: "#9CA3AF", fontSize: 11 }} numberOfLines={1}>
                  {t("driver.map.incoming.pickup")} {incomingOrder.pickupAddress}
                </Text>
                <Text style={{ color: "#9CA3AF", fontSize: 11 }} numberOfLines={1}>
                  {t("driver.map.incoming.dropoff")} {incomingOrder.dropoffAddress}
                </Text>

                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6, marginBottom: 8 }}>
                  <Text style={{ color: "#F9FAFB", fontSize: 12, fontWeight: "600" }}>
                    {incomingOrder.distanceMiles.toFixed(1)} mi • {incomingOrder.etaMinutes} min
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    {incomingOrder.surgeLabel && (
                      <View style={{ marginRight: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: "#FEF3C7" }}>
                        <Text style={{ color: "#B45309", fontSize: 10, fontWeight: "700" }}>
                          {incomingOrder.surgeLabel}
                        </Text>
                      </View>
                    )}
                    <Text style={{ color: "#BBF7D0", fontSize: 13, fontWeight: "700" }}>
                      {incomingOrder.price.toFixed(2)} $
                    </Text>
                  </View>
                </View>

                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => handleRejectIncomingOrder("reject")}
                    activeOpacity={0.9}
                    style={{ flex: 1, paddingVertical: 8, borderRadius: 999, backgroundColor: "#111827", borderWidth: 1, borderColor: "#FCA5A5", alignItems: "center" }}
                  >
                    <Text style={{ color: "#FCA5A5", fontSize: 13, fontWeight: "700" }}>
                      {t("driver.map.incoming.decline")}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleAcceptIncomingOrder}
                    activeOpacity={0.9}
                    style={{ flex: 1, paddingVertical: 8, borderRadius: 999, backgroundColor: "#22C55E", alignItems: "center" }}
                  >
                    <Text style={{ color: "#022C22", fontSize: 13, fontWeight: "700" }}>
                      {t("driver.map.incoming.accept")}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {restaurantsLoading && (
              <View style={{ position: "absolute", left: 12, top: 60, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "rgba(15,23,42,0.92)" }}>
                <Text style={{ color: "#9CA3AF", fontSize: 10 }}>{t("driver.map.restaurantsLoading")}</Text>
              </View>
            )}

            {!isOnline && (
              <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, top: "48%", alignItems: "center" }}>
                <TouchableOpacity
                  onPress={handleToggleOnline}
                  activeOpacity={0.9}
                  style={{ height: 120, width: 120, borderRadius: 60, backgroundColor: "#2563EB", alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8 }}
                >
                  <Text style={{ color: "white", fontSize: 26, fontWeight: "800", letterSpacing: 1 }}>GO</Text>
                </TouchableOpacity>
              </View>
            )}

            {hasLocation && (
              <View pointerEvents="box-none" style={{ position: "absolute", right: 18, bottom: 200 }}>
                <TouchableOpacity
                  onPress={centerOnDriver}
                  activeOpacity={0.9}
                  style={{ height: 44, width: 44, borderRadius: 22, backgroundColor: "#0F172A", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#1D4ED8", shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }}
                >
                  <Text style={{ color: "#BFDBFE", fontSize: 20, fontWeight: "700" }}>◎</Text>
                </TouchableOpacity>
              </View>
            )}

            <Animated.View
              style={{ position: "absolute", left: 0, right: 0, top: sheetTop, paddingHorizontal: 12, paddingBottom: 24 }}
              {...panResponder.panHandlers}
            >
              <View
                style={{ borderRadius: 24, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, backgroundColor: "rgba(15,23,42,0.96)", shadowColor: "#000", shadowOpacity: 0.45, shadowRadius: 20, shadowOffset: { width: 0, height: -4 }, elevation: 16 }}
              >
                <TouchableOpacity
                  onPress={() => animateSheet(sheetState.current === "collapsed" ? "expanded" : "collapsed")}
                  activeOpacity={0.7}
                  style={{ alignItems: "center", marginBottom: 10 }}
                >
                  <View style={{ width: 42, height: 4, borderRadius: 999, backgroundColor: "#4B5563" }} />
                </TouchableOpacity>

                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <Text style={{ color: "white", fontSize: 15, fontWeight: "600" }}>{t("driver.map.statusTitle")}</Text>
                  <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: isOnline ? "#064E3B" : "#7F1D1D" }}>
                    <Text style={{ color: isOnline ? "#6EE7B7" : "#FECACA", fontSize: 11, fontWeight: "600" }}>
                      {isOnline ? t("driver.map.online") : t("driver.map.offline")}
                    </Text>
                  </View>
                </View>

                <Text style={{ color: isOnline ? "#22C55E" : "#F97373", fontSize: 13, fontWeight: "600", marginBottom: 4 }}>
                  {isOnline ? t("driver.map.statusOnlineTitle") : t("driver.map.statusOfflineTitle")}
                </Text>

                <Text style={{ color: "#E5E7EB", fontSize: 11 }}>{statusSubtitle}</Text>

                <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: "#1E293B", paddingTop: 10 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
                    <View>
                      <Text style={{ color: "#9CA3AF", fontSize: 11 }}>
                        {t("driver.map.zoneActivityTitle")}
                        {currentZone ? ` (${currentZone.name})` : ""}
                      </Text>
                      <Text style={{ color: currentZone ? getZoneColors(currentZone.activity).labelColor : "#A5B4FC", fontSize: 13, fontWeight: "600" }}>
                        {currentZone ? getActivityLabel(currentZone.activity) : t("driver.map.zoneUnknown")}
                      </Text>

                      {boostLabelGlobal && (
                        <Text style={{ color: "#FBBF24", fontSize: 11, marginTop: 4, fontWeight: "600" }}>
                          {t("driver.map.bonusEstimated", { boost: boostLabelGlobal })}
                        </Text>
                      )}
                    </View>

                    <View>
                      <Text style={{ color: "#9CA3AF", fontSize: 11, textAlign: "right" }}>{t("driver.map.nextUpdateTitle")}</Text>
                      <Text style={{ color: "#E5E7EB", fontSize: 13, fontWeight: "500", textAlign: "right" }}>
                        {t("driver.map.updateIntervalOnline")}
                      </Text>
                    </View>
                  </View>

                  {isOnline && (
                    <TouchableOpacity
                      onPress={handleToggleOnline}
                      activeOpacity={0.9}
                      style={{ marginTop: 6, paddingVertical: 10, borderRadius: 999, backgroundColor: "#111827", borderWidth: 1, borderColor: "#F97373", alignItems: "center" }}
                    >
                      <Text style={{ color: "#FCA5A5", fontWeight: "700", fontSize: 13 }}>
                        {t("driver.map.goOffline")}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {IS_DEV && (
                    <View style={{ marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#1F2937" }}>
                      <TouchableOpacity
                        onPress={triggerTestIncomingOrder}
                        activeOpacity={0.8}
                        style={{ alignSelf: "center", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: "#0F172A", borderWidth: 1, borderColor: "#4B5563" }}
                      >
                        <Text style={{ color: "#9CA3AF", fontSize: 11 }}>
                          {t("driver.map.debug.testIncomingOrder")}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: "#1E293B", paddingTop: 10, maxHeight: 190 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <Text style={{ color: "#E5E7EB", fontSize: 14, fontWeight: "600" }}>
                      {t("driver.map.myOrders.title")}
                    </Text>

                    <TouchableOpacity
                      onPress={() => {
                        if (!driverId) return;
                        (async () => {
                          try {
                            setOrdersLoading(true);
                            setOrdersError(null);

                            const { data: memberships, error: membershipError } = await supabase
                              .from("order_members")
                              .select("order_id")
                              .eq("user_id", driverId)
                              .eq("role", "driver");

                            if (membershipError) throw membershipError;

                            const orderIds = (memberships ?? []).map((m: any) => m.order_id).filter(Boolean);

                            if (orderIds.length === 0) {
                              setDriverOrders([]);
                            } else {
                              const { data: ordersData, error: ordersError } = await supabase
                                .from("orders")
                                .select(
                                  `
                                  id,
                                  kind,
                                  status,
                                  created_at,
                                  restaurant_name,
                                  pickup_address,
                                  dropoff_address,
                                  distance_miles,
                                  delivery_fee,
                                  driver_delivery_payout,
                                  total
                                `
                                )
                                .in("id", orderIds)
                                .order("created_at", { ascending: false });

                              if (ordersError) throw ordersError;
                              setDriverOrders((ordersData as any as DriverOrder[]) ?? []);
                            }
                          } catch (e: any) {
                            console.log("Erreur refresh commandes driver:", e);
                            setOrdersError(e?.message ?? t("driver.map.myOrders.loading"));
                          } finally {
                            setOrdersLoading(false);
                          }
                        })();
                      }}
                    >
                      <Text style={{ color: "#3B82F6", fontSize: 11, fontWeight: "500" }}>
                        {t("shared.common.refresh", "Rafraîchir")}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {ordersLoading && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <ActivityIndicator size="small" color="#FFFFFF" />
                      <Text style={{ color: "#9CA3AF", fontSize: 11 }}>{t("driver.map.myOrders.loading")}</Text>
                    </View>
                  )}

                  {ordersError && (
                    <Text style={{ color: "#FCA5A5", fontSize: 11, marginBottom: 4 }}>{ordersError}</Text>
                  )}

                  <ScrollView style={{ maxHeight: 150 }} contentContainerStyle={{ paddingBottom: 4 }}>
                    {driverOrders.length === 0 && !ordersLoading ? (
                      <View style={{ paddingVertical: 8 }}>
                        <Text style={{ color: "#9CA3AF", fontSize: 11 }}>{t("driver.map.myOrders.emptyTitle")}</Text>
                        <Text style={{ color: "#6B7280", fontSize: 10, marginTop: 2 }}>{t("driver.map.myOrders.emptySubtitle")}</Text>
                      </View>
                    ) : (
                      driverOrders.map((order) => renderOrderCard(order))
                    )}
                  </ScrollView>
                </View>
              </View>
            </Animated.View>

            {errorMsg && (
              <View style={{ position: "absolute", top: 12, left: 12, right: 12, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "#7F1D1D" }}>
                <Text style={{ color: "white", fontSize: 11 }}>{errorMsg}</Text>
              </View>
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
