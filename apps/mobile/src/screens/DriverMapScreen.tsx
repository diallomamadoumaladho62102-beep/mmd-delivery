import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  PanResponder,
  Dimensions,
  ScrollView,
  Image,
} from "react-native";
import Mapbox from "@rnmapbox/maps";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import * as Location from "expo-location";
import { useTranslation } from "react-i18next";
import { useKeepAwake } from "expo-keep-awake";
import { supabase } from "../lib/supabase";
import {
  calculateHeading,
  fetchNavigationRoute,
  fitCameraToRoute,
  shouldReroute,
  type NavigationRoute,
} from "../lib/navigationService";

type Nav = NativeStackNavigationProp<RootStackParamList, "DriverMap">;

type MapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

const SCREEN_HEIGHT = Dimensions.get("window").height;
const SHEET_EXPANDED_TOP = SCREEN_HEIGHT - 500;
const SHEET_COLLAPSED_TOP = SCREEN_HEIGHT - 176;

const NAVIGATION_FOLLOW_ZOOM = 17.2;
const NAVIGATION_FOLLOW_PITCH = 56;
const NAVIGATION_CAMERA_THROTTLE_MS = 1100;
const NAVIGATION_MIN_HEADING_DISTANCE_METERS = 4;
const NAVIGATION_REROUTE_THRESHOLD_METERS = 110;
const NAVIGATION_REROUTE_COOLDOWN_MS = 12000;

const IS_DEV = typeof __DEV__ !== "undefined" ? __DEV__ : false;

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || "";
const MAP_STYLE_STREETS =
  (Mapbox as any).StyleURL?.Street ?? "mapbox://styles/mapbox/streets-v12";
const MAP_STYLE_DARK =
  (Mapbox as any).StyleURL?.Dark ?? "mapbox://styles/mapbox/dark-v11";

if (MAPBOX_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_TOKEN);
} else if (IS_DEV) {
  console.log("[DriverMapScreen] EXPO_PUBLIC_MAPBOX_TOKEN manquant");
}

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

type OrderSourceTable = "orders" | "delivery_requests";

type DriverOrder = {
  id: string;
  source_table: OrderSourceTable;
  kind: OrderKind;
  status: OrderStatus;
  created_at: string | null;
  restaurant_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_miles: number | null;
  driver_delivery_payout: number | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  pickup_lon?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  dropoff_lon?: number | null;
};

type ZoneActivity = "calm" | "normal" | "busy" | "very_busy";

type DriverZone = {
  id: string;
  name: string;
  center: { lat: number; lng: number };
  radiusMeters: number;
  activity: ZoneActivity;
  polygon: { latitude: number; longitude: number }[];
};

type RestaurantPin = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  logoUrl: string | null;
};

type IncomingOrderBanner = {
  id: string;
  offerId?: string | null;
  sourceTable?: OrderSourceTable;
  pickupLat?: number | null;
  pickupLng?: number | null;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
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

function getZoneColors(activity: ZoneActivity) {
  switch (activity) {
    case "very_busy":
      return {
        strokeColor: "rgba(239,68,68,0.95)",
        fillColor: "rgba(248,113,113,0.26)",
        labelColor: "#EF4444",
        haloColor: "rgba(239,68,68,0.18)",
      };
    case "busy":
      return {
        strokeColor: "rgba(249,115,22,0.95)",
        fillColor: "rgba(251,146,60,0.24)",
        labelColor: "#F97316",
        haloColor: "rgba(249,115,22,0.18)",
      };
    case "normal":
      return {
        strokeColor: "rgba(234,179,8,0.92)",
        fillColor: "rgba(250,204,21,0.20)",
        labelColor: "#EAB308",
        haloColor: "rgba(234,179,8,0.16)",
      };
    case "calm":
    default:
      return {
        strokeColor: "rgba(34,197,94,0.90)",
        fillColor: "rgba(34,197,94,0.16)",
        labelColor: "#22C55E",
        haloColor: "rgba(34,197,94,0.16)",
      };
  }
}

function distanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
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

function formatMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)} USD`;
}

function getSafeDriverPayout(
  order: Pick<DriverOrder, "driver_delivery_payout"> | null | undefined,
) {
  const payout = order?.driver_delivery_payout;
  return typeof payout === "number" && Number.isFinite(payout) ? payout : null;
}

function getOrderCompositeKey(order: Pick<DriverOrder, "id" | "source_table">) {
  return `${order.source_table}:${order.id}`;
}

function formatMiles(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)} mi`;
}

function numberOrNull(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isValidCoordinate(latValue: unknown, lngValue: unknown) {
  const lat = Number(latValue);
  const lng = Number(lngValue);

  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function cleanRestaurantName(value: unknown) {
  const name = String(value || "").trim();
  return name || "Restaurant";
}

function regionToZoom(region: MapRegion): number {
  const delta = Math.max(region.latitudeDelta, region.longitudeDelta);
  const zoom = Math.log2(360 / Math.max(delta, 0.0001));
  return Math.max(3, Math.min(18, zoom));
}

function zonePolygonToFeature(zone: DriverZone) {
  const ring = zone.polygon.map((point) => [point.longitude, point.latitude]);

  if (ring.length > 0) {
    const first = ring[0];
    const last = ring[ring.length - 1];

    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push(first);
    }
  }

  return {
    type: "Feature" as const,
    properties: {
      id: zone.id,
      name: zone.name,
      activity: zone.activity,
    },
    geometry: {
      type: "Polygon" as const,
      coordinates: [ring],
    },
  };
}

export default function DriverMapScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useTranslation();

  useKeepAwake();

  const [region, setRegion] = useState<MapRegion>({
    latitude: 40.73061,
    longitude: -73.935242,
    latitudeDelta: 0.06,
    longitudeDelta: 0.06,
  });

  const [hasLocation, setHasLocation] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // DriverHomeScreen is the only place that controls online/offline, GPS tracking,
  // live offers, and sounds. DriverMapScreen stays passive to avoid duplicate listeners.
  const isOnline = false;

  const [restaurants, setRestaurants] = useState<RestaurantPin[]>([]);
  const [restaurantsLoading, setRestaurantsLoading] = useState(false);

  const [currentZone, setCurrentZone] = useState<DriverZone | null>(null);

  const [driverId, setDriverId] = useState<string | null>(null);

  const [driverOrders, setDriverOrders] = useState<DriverOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  const [incomingOrder, setIncomingOrder] =
    useState<IncomingOrderBanner | null>(null);
  const [incomingTimer, setIncomingTimer] = useState(0);
  const [incomingActionLoading, setIncomingActionLoading] = useState(false);
  const [navigationRoute, setNavigationRoute] = useState<NavigationRoute | null>(null);
  const [navigationRouteLoading, setNavigationRouteLoading] = useState(false);
  const [driverHeading, setDriverHeading] = useState(0);
  const [followNavigationMode, setFollowNavigationMode] = useState(true);

  const [isNightMode, setIsNightMode] = useState(false);

  const cameraRef = useRef<Mapbox.Camera | null>(null);
  const locationSubscriptionRef = useRef<Location.LocationSubscription | null>(
    null,
  );
  const hasCenteredOnDriverRef = useRef(false);
  const previousDriverPointRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const lastFollowCameraAtRef = useRef(0);
  const lastRerouteAtRef = useRef(0);
  const rerouteInFlightRef = useRef(false);

  const sheetTop = useRef(new Animated.Value(SHEET_COLLAPSED_TOP)).current;
  const sheetState = useRef<"collapsed" | "expanded">("collapsed");

  const incomingTranslateY = useRef(new Animated.Value(-18)).current;
  const incomingOpacity = useRef(new Animated.Value(0)).current;

  const mapStyleURL = isNightMode ? MAP_STYLE_DARK : MAP_STYLE_STREETS;

  const animateSheet = useCallback(
    (target: "collapsed" | "expanded") => {
      const toValue =
        target === "collapsed" ? SHEET_COLLAPSED_TOP : SHEET_EXPANDED_TOP;
      sheetState.current = target;

      Animated.spring(sheetTop, {
        toValue,
        useNativeDriver: false,
        tension: 45,
        friction: 10,
      }).start();
    },
    [sheetTop],
  );

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dy) > 10,
      onPanResponderMove: (_, gestureState) => {
        const currentTop =
          sheetState.current === "collapsed"
            ? SHEET_COLLAPSED_TOP
            : SHEET_EXPANDED_TOP;

        let newTop = currentTop + gestureState.dy;
        newTop = Math.max(
          SHEET_EXPANDED_TOP,
          Math.min(SHEET_COLLAPSED_TOP, newTop),
        );
        sheetTop.setValue(newTop);
      },
      onPanResponderRelease: (_, gestureState) => {
        const threshold = 32;

        if (gestureState.dy < -threshold) {
          animateSheet("expanded");
          return;
        }

        if (gestureState.dy > threshold) {
          animateSheet("collapsed");
          return;
        }

        const currentValue =
          (sheetTop as any).__getValue?.() ?? SHEET_COLLAPSED_TOP;
        const midpoint = (SHEET_EXPANDED_TOP + SHEET_COLLAPSED_TOP) / 2;
        animateSheet(currentValue < midpoint ? "expanded" : "collapsed");
      },
    }),
  ).current;

  const nearbyRestaurantCount = useMemo(() => {
    if (!hasLocation) return 0;

    return restaurants.filter((r) => {
      const dist = distanceMeters(
        region.latitude,
        region.longitude,
        r.latitude,
        r.longitude,
      );
      return dist < 2500;
    }).length;
  }, [hasLocation, restaurants, region.latitude, region.longitude]);

  const nearbyRestaurants = useMemo(() => {
    if (!hasLocation) return [];

    return restaurants
      .map((restaurant) => ({
        ...restaurant,
        distanceFromDriver: distanceMeters(
          region.latitude,
          region.longitude,
          restaurant.latitude,
          restaurant.longitude,
        ),
      }))
      .filter((restaurant) => restaurant.distanceFromDriver < 2500)
      .sort((a, b) => a.distanceFromDriver - b.distanceFromDriver)
      .slice(0, 20);
  }, [hasLocation, restaurants, region.latitude, region.longitude]);

  const zoneOpportunityScore = useMemo(() => {
    const base =
      currentZone?.activity === "very_busy"
        ? 92
        : currentZone?.activity === "busy"
          ? 78
          : currentZone?.activity === "normal"
            ? 59
            : currentZone?.activity === "calm"
              ? 34
              : 18;

    const restaurantBoost = Math.min(nearbyRestaurantCount * 2, 16);
    return Math.min(base + restaurantBoost, 99);
  }, [currentZone, nearbyRestaurantCount]);

  const zoneOpportunityLabel = useMemo(() => {
    if (zoneOpportunityScore >= 85) return "Elite";
    if (zoneOpportunityScore >= 65) return "Très fort";
    if (zoneOpportunityScore >= 45) return "Prometteur";
    return "Calme";
  }, [zoneOpportunityScore]);

  const statusTitle = isOnline
    ? t("driver.map.online")
    : t("driver.map.offline");

  const statusSubtitle = isOnline
    ? t("driver.map.statusOnlineSubtitle")
    : hasLocation
      ? t("driver.map.statusOfflineSubtitleHasLocation")
      : t("driver.map.statusOfflineSubtitleNoLocation");

  const boostMultiplier =
    currentZone?.activity === "very_busy"
      ? 1.6
      : currentZone?.activity === "busy"
        ? 1.3
        : 1.0;

  const boostLabelGlobal =
    boostMultiplier > 1 ? `x${boostMultiplier.toFixed(1)}` : null;

  const sheetSummaryCardColor = isOnline ? "#031A12" : "#1A0B0F";

  const isNavigationActive = Boolean(incomingOrder && navigationRoute?.geometry);

  const locateDriver = useCallback(async () => {
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

      setRegion((prev) => ({
        ...prev,
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
        latitudeDelta: 0.04,
        longitudeDelta: 0.04,
      }));

      setHasLocation(true);
      setLoading(false);

      locationSubscriptionRef.current?.remove();
      locationSubscriptionRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000,
          distanceInterval: 15,
        },
        (pos) => {
          const { latitude, longitude } = pos.coords;

          setRegion((prev) => ({
            ...prev,
            latitude,
            longitude,
          }));

          setHasLocation(true);
        },
      );
    } catch (e: any) {
      console.log("Erreur DriverMapScreen:", e);
      setErrorMsg(e?.message ?? t("driver.map.permissionDenied"));
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void locateDriver();

    return () => {
      locationSubscriptionRef.current?.remove();
    };
  }, [locateDriver]);

  useEffect(() => {
    if (!hasLocation || hasCenteredOnDriverRef.current) return;

    hasCenteredOnDriverRef.current = true;

    const timer = setTimeout(() => {
      centerOnDriver();
    }, 450);

    return () => clearTimeout(timer);
  }, [hasLocation, region.latitude, region.longitude]);

  useEffect(() => {
    if (incomingOrder) {
      Animated.parallel([
        Animated.spring(incomingTranslateY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 55,
          friction: 9,
        }),
        Animated.timing(incomingOpacity, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    Animated.parallel([
      Animated.timing(incomingTranslateY, {
        toValue: -18,
        duration: 180,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(incomingOpacity, {
        toValue: 0,
        duration: 160,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }, [incomingOpacity, incomingOrder, incomingTranslateY]);

  useEffect(() => {
    let cancelled = false;

    async function loadDriver() {
      try {
        const { data, error } = await supabase.auth.getUser();

        if (error || !data?.user) {
          console.log(
            "🚫 Impossible de récupérer l'utilisateur (driver)",
            error,
          );
          return;
        }

        if (!cancelled) {
          setDriverId(data.user.id);
        }
      } catch (e) {
        console.log("Erreur loadDriver:", e);
      }
    }

    void loadDriver();

    return () => {
      cancelled = true;
    };
  }, []);

  const fetchDriverOrders = useCallback(async () => {
    if (!driverId) return;

    try {
      setOrdersLoading(true);
      setOrdersError(null);

      // 1) Commandes déjà assignées au driver via order_members
      const { data: memberships, error: membershipError } = await supabase
        .from("order_members")
        .select("order_id")
        .eq("user_id", driverId)
        .eq("role", "driver");

      if (membershipError) throw membershipError;

      const assignedOrderIds = (memberships ?? [])
        .map((m: any) => m.order_id)
        .filter(Boolean);

      let assignedOrders: DriverOrder[] = [];

      if (assignedOrderIds.length > 0) {
        const { data, error } = await supabase
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
            driver_delivery_payout,
            pickup_lat,
            pickup_lng,
            pickup_lon,
            dropoff_lat,
            dropoff_lng,
            dropoff_lon
          `,
          )
          .in("id", assignedOrderIds)
          .order("created_at", { ascending: false });

        if (error) throw error;

        assignedOrders = (
          (data as Omit<DriverOrder, "source_table">[]) ?? []
        ).map((order) => ({
          ...order,
          source_table: "orders" as const,
        }));
      }

      // 2) Commandes disponibles depuis la table orders :
      // - commandes restaurant prêtes : status = ready
      // - demandes pickup/dropoff : status = pending + kind = pickup_dropoff
      // Important : orders.kind est un enum et n'accepte pas "delivery".
      const { data: availableOrdersData, error: availableOrdersError } =
        await supabase
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
          driver_delivery_payout,
          pickup_lat,
          pickup_lng,
          pickup_lon,
          dropoff_lat,
          dropoff_lng,
          dropoff_lon
        `,
          )
          .is("driver_id", null)
          .or("status.eq.ready,and(status.eq.pending,kind.eq.pickup_dropoff)")
          .order("created_at", { ascending: false });

      if (availableOrdersError) throw availableOrdersError;

      const availableOrders: DriverOrder[] = (
        (availableOrdersData as Omit<DriverOrder, "source_table">[]) ?? []
      ).map((order) => ({
        ...order,
        source_table: "orders" as const,
      }));

      // 3) Demandes MMD Delivery disponibles depuis delivery_requests.
      // Important production:
      // - Do not select delivery_requests.kind here. Some production API schema caches
      //   can be stale even after the DB column exists.
      // - This table already represents MMD Delivery requests, so the app safely maps
      //   them as kind = "delivery" after loading.
      // - Food orders are untouched because they come from the orders table above.
      const { data: deliveryRequestsData, error: deliveryRequestsError } =
        await supabase
          .from("delivery_requests")
          .select(
            `
          id,
          status,
          created_at,
          pickup_address,
          dropoff_address,
          pickup_lat,
          pickup_lng,
          dropoff_lat,
          dropoff_lng,
          distance_miles,
          driver_delivery_payout
        `,
          )
          .in("status", ["pending", "paid_pending", "processing_pending"])
          .eq("payment_status", "paid")
          .is("driver_id", null)
          .order("created_at", { ascending: false });

      if (deliveryRequestsError) throw deliveryRequestsError;

      const availableDeliveryRequests: DriverOrder[] = (
        (deliveryRequestsData as any[]) ?? []
      ).map((request) => ({
        id: String(request.id),
        kind: "delivery",
        status: String(request.status ?? "pending") as OrderStatus,
        created_at: request.created_at ?? null,
        restaurant_name: null,
        pickup_address: request.pickup_address ?? null,
        dropoff_address: request.dropoff_address ?? null,
        pickup_lat: numberOrNull(request.pickup_lat),
        pickup_lng: numberOrNull(request.pickup_lng),
        dropoff_lat: numberOrNull(request.dropoff_lat),
        dropoff_lng: numberOrNull(request.dropoff_lng),
        distance_miles:
          typeof request.distance_miles === "number"
            ? request.distance_miles
            : Number.isFinite(Number(request.distance_miles))
              ? Number(request.distance_miles)
              : null,
        driver_delivery_payout:
          typeof request.driver_delivery_payout === "number"
            ? request.driver_delivery_payout
            : Number.isFinite(Number(request.driver_delivery_payout))
              ? Number(request.driver_delivery_payout)
              : null,
        source_table: "delivery_requests" as const,
      }));

      // 4) Fusion sans doublons multi-table.
      // Important: orders.id and delivery_requests.id can be identical, so the source table
      // must be part of the key to avoid hiding a valid order.
      const merged = [
        ...assignedOrders,
        ...availableOrders,
        ...availableDeliveryRequests,
      ];
      const uniqueOrders = Array.from(
        new Map(
          merged.map((order) => [getOrderCompositeKey(order), order]),
        ).values(),
      );

      setDriverOrders(uniqueOrders);
    } catch (e: any) {
      console.log("Erreur chargement commandes driver (map):", e);
      setOrdersError(e?.message ?? t("driver.map.myOrders.loading"));
    } finally {
      setOrdersLoading(false);
    }
  }, [driverId, t]);

  useEffect(() => {
    if (!driverId) return;
    void fetchDriverOrders();
  }, [driverId, fetchDriverOrders]);


  const loadLatestIncomingOffer = useCallback(async () => {
    if (!driverId) return;

    try {
      const nowIso = new Date().toISOString();

      const { data: orderOffers, error: orderOfferError } = await supabase
        .from("driver_order_offers")
        .select(
          "id, order_id, driver_id, restaurant_name, pickup_address, dropoff_address, driver_price_cents, distance_miles, eta_minutes, surge_label, status, expires_at",
        )
        .eq("driver_id", driverId)
        .eq("status", "pending")
        .gt("expires_at", nowIso)
        .order("created_at", { ascending: false })
        .limit(1);

      if (orderOfferError) throw orderOfferError;

      const orderOffer = orderOffers?.[0] as any | undefined;

      if (orderOffer) {
        const secondsLeft = Math.max(
          1,
          Math.ceil((new Date(orderOffer.expires_at).getTime() - Date.now()) / 1000),
        );

        const { data: orderRouteRow, error: orderRouteError } = await supabase
          .from("orders")
          .select("pickup_lat,pickup_lng,pickup_lon,dropoff_lat,dropoff_lng,dropoff_lon")
          .eq("id", orderOffer.order_id)
          .maybeSingle();

        if (orderRouteError) {
          console.log("Driver map order route warning:", orderRouteError);
        }

        const pickupLng = numberOrNull(orderRouteRow?.pickup_lng ?? orderRouteRow?.pickup_lon);
        const dropoffLng = numberOrNull(orderRouteRow?.dropoff_lng ?? orderRouteRow?.dropoff_lon);

        setIncomingOrder({
          id: String(orderOffer.order_id),
          offerId: String(orderOffer.id),
          sourceTable: "orders",
          pickupLat: numberOrNull(orderRouteRow?.pickup_lat),
          pickupLng,
          dropoffLat: numberOrNull(orderRouteRow?.dropoff_lat),
          dropoffLng,
          restaurantName: orderOffer.restaurant_name ?? "Restaurant order",
          pickupAddress: orderOffer.pickup_address ?? "Pickup location",
          dropoffAddress: orderOffer.dropoff_address ?? "Dropoff location",
          price:
            typeof orderOffer.driver_price_cents === "number"
              ? orderOffer.driver_price_cents / 100
              : 0,
          distanceMiles:
            typeof orderOffer.distance_miles === "number"
              ? orderOffer.distance_miles
              : Number.isFinite(Number(orderOffer.distance_miles))
                ? Number(orderOffer.distance_miles)
                : 0,
          etaMinutes:
            typeof orderOffer.eta_minutes === "number"
              ? orderOffer.eta_minutes
              : Number.isFinite(Number(orderOffer.eta_minutes))
                ? Number(orderOffer.eta_minutes)
                : 0,
          surgeLabel: orderOffer.surge_label ?? null,
        });
        setIncomingTimer(secondsLeft);
        return;
      }

      const { data: deliveryOffers, error: deliveryOfferError } = await supabase
        .from("delivery_request_driver_offers")
        .select("id, delivery_request_id, driver_id, status, expires_at")
        .eq("driver_id", driverId)
        .eq("status", "pending")
        .gt("expires_at", nowIso)
        .order("created_at", { ascending: false })
        .limit(1);

      if (deliveryOfferError) throw deliveryOfferError;

      const deliveryOffer = deliveryOffers?.[0] as any | undefined;

      if (!deliveryOffer) {
        setIncomingOrder(null);
        setIncomingTimer(0);
        return;
      }

      const { data: request, error: requestError } = await supabase
        .from("delivery_requests")
        .select(
          "id,pickup_address,dropoff_address,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,distance_miles,eta_minutes,driver_delivery_payout",
        )
        .eq("id", deliveryOffer.delivery_request_id)
        .maybeSingle();

      if (requestError) throw requestError;

      if (!request) {
        setIncomingOrder(null);
        setIncomingTimer(0);
        return;
      }

      const secondsLeft = Math.max(
        1,
        Math.ceil((new Date(deliveryOffer.expires_at).getTime() - Date.now()) / 1000),
      );

      setIncomingOrder({
        id: String(deliveryOffer.delivery_request_id),
        offerId: String(deliveryOffer.id),
        sourceTable: "delivery_requests",
        pickupLat: numberOrNull(request.pickup_lat),
        pickupLng: numberOrNull(request.pickup_lng),
        dropoffLat: numberOrNull(request.dropoff_lat),
        dropoffLng: numberOrNull(request.dropoff_lng),
        restaurantName: "MMD Delivery",
        pickupAddress: request.pickup_address ?? "Pickup location",
        dropoffAddress: request.dropoff_address ?? "Dropoff location",
        price:
          typeof request.driver_delivery_payout === "number"
            ? request.driver_delivery_payout
            : Number.isFinite(Number(request.driver_delivery_payout))
              ? Number(request.driver_delivery_payout)
              : 0,
        distanceMiles:
          typeof request.distance_miles === "number"
            ? request.distance_miles
            : Number.isFinite(Number(request.distance_miles))
              ? Number(request.distance_miles)
              : 0,
        etaMinutes:
          typeof request.eta_minutes === "number"
            ? request.eta_minutes
            : Number.isFinite(Number(request.eta_minutes))
              ? Number(request.eta_minutes)
              : 0,
        surgeLabel: null,
      });
      setIncomingTimer(secondsLeft);
    } catch (e) {
      console.log("Erreur chargement incoming offer map:", e);
    }
  }, [driverId]);

  useEffect(() => {
    if (!driverId) return;

    void loadLatestIncomingOffer();

    const channel = supabase
      .channel(`driver-map-offers-${driverId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "driver_order_offers",
          filter: `driver_id=eq.${driverId}`,
        },
        () => void loadLatestIncomingOffer(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "delivery_request_driver_offers",
          filter: `driver_id=eq.${driverId}`,
        },
        () => void loadLatestIncomingOffer(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [driverId, loadLatestIncomingOffer]);

  useEffect(() => {
    if (!hasLocation) return;

    let cancelled = false;

    async function loadRestaurants() {
      try {
        setRestaurantsLoading(true);

        const response = await supabase
          .from("restaurant_profiles")
          .select(
            "user_id, restaurant_name, location_lat, location_lng, status, is_accepting_orders",
          )
          .eq("status", "approved")
          .eq("is_accepting_orders", true)
          .limit(150);

        if (response.error) {
          console.log("Erreur chargement restaurants:", response.error);

          if (!cancelled) {
            setRestaurants([]);
          }

          return;
        }

        if (!response.data || cancelled) return;

        const mapped: RestaurantPin[] = (response.data as any[])
          .filter((row) => {
            return (
              !!row?.user_id &&
              isValidCoordinate(row?.location_lat, row?.location_lng)
            );
          })
          .map((row) => ({
            id: String(row.user_id),
            name: cleanRestaurantName(row.restaurant_name),
            latitude: Number(row.location_lat),
            longitude: Number(row.location_lng),
            logoUrl: null,
          }));

        setRestaurants(mapped);
      } catch (e) {
        console.log("Exception loadRestaurants:", e);

        if (!cancelled) {
          setRestaurants([]);
        }
      } finally {
        if (!cancelled) {
          setRestaurantsLoading(false);
        }
      }
    }

    void loadRestaurants();

    return () => {
      cancelled = true;
    };
  }, [hasLocation]);

  useEffect(() => {
    if (!hasLocation) {
      setCurrentZone(null);
      return;
    }

    let bestZone: DriverZone | null = null;
    let bestDist = Infinity;

    for (const zone of DRIVER_ZONES) {
      const d = distanceMeters(
        region.latitude,
        region.longitude,
        zone.center.lat,
        zone.center.lng,
      );

      if (d < zone.radiusMeters && d < bestDist) {
        bestDist = d;
        bestZone = zone;
      }
    }

    setCurrentZone(bestZone);
  }, [region.latitude, region.longitude, hasLocation]);

  useEffect(() => {
    const now = new Date();
    const hour = now.getHours();
    setIsNightMode(hour >= 19 || hour < 6);
  }, []);

  useEffect(() => {
    if (!incomingOrder) return;

    if (incomingTimer <= 0) {
      handleRejectIncomingOrder("timeout");
      return;
    }

    const id = setTimeout(() => setIncomingTimer((prev) => prev - 1), 1000);
    return () => clearTimeout(id);
  }, [incomingOrder, incomingTimer]);

  useEffect(() => {
    let cancelled = false;

    async function buildLiveNavigationRoute() {
      if (!incomingOrder || !hasLocation) {
        setNavigationRoute(null);
        setNavigationRouteLoading(false);
        return;
      }

      if (
        !Number.isFinite(incomingOrder.pickupLat ?? NaN) ||
        !Number.isFinite(incomingOrder.pickupLng ?? NaN)
      ) {
        setNavigationRoute(null);
        setNavigationRouteLoading(false);
        return;
      }

      try {
        setNavigationRouteLoading(true);

        const hasDropoff =
          Number.isFinite(incomingOrder.dropoffLat ?? NaN) &&
          Number.isFinite(incomingOrder.dropoffLng ?? NaN);

        const route = await fetchNavigationRoute(
          { latitude: region.latitude, longitude: region.longitude },
          {
            latitude: hasDropoff
              ? Number(incomingOrder.dropoffLat)
              : Number(incomingOrder.pickupLat),
            longitude: hasDropoff
              ? Number(incomingOrder.dropoffLng)
              : Number(incomingOrder.pickupLng),
          },
          hasDropoff
            ? [
                {
                  latitude: Number(incomingOrder.pickupLat),
                  longitude: Number(incomingOrder.pickupLng),
                },
              ]
            : [],
        );

        if (cancelled) return;

        setNavigationRoute(route);
        lastRerouteAtRef.current = Date.now();

        if (route) {
          void fitCameraToRoute(cameraRef as any, route.geometry);
        }
      } catch (e) {
        console.log("DriverMapScreen navigation route error:", e);
        if (!cancelled) setNavigationRoute(null);
      } finally {
        if (!cancelled) setNavigationRouteLoading(false);
      }
    }

    void buildLiveNavigationRoute();

    return () => {
      cancelled = true;
    };
  }, [
    hasLocation,
    incomingOrder?.id,
    incomingOrder?.pickupLat,
    incomingOrder?.pickupLng,
    incomingOrder?.dropoffLat,
    incomingOrder?.dropoffLng,
    region.latitude,
    region.longitude,
  ]);

  useEffect(() => {
    if (!incomingOrder || !hasLocation || !navigationRoute?.geometry) {
      return;
    }

    if (navigationRouteLoading || rerouteInFlightRef.current) {
      return;
    }

    const activeIncomingOrder = incomingOrder;

    const currentPoint = {
      latitude: region.latitude,
      longitude: region.longitude,
    };

    const needsReroute = shouldReroute(
      currentPoint,
      navigationRoute.geometry,
      NAVIGATION_REROUTE_THRESHOLD_METERS,
    );

    if (!needsReroute) {
      return;
    }

    const now = Date.now();

    if (now - lastRerouteAtRef.current < NAVIGATION_REROUTE_COOLDOWN_MS) {
      return;
    }

    let cancelled = false;

    async function rerouteLiveNavigation() {
      try {
        rerouteInFlightRef.current = true;
        lastRerouteAtRef.current = Date.now();
        setNavigationRouteLoading(true);

        const hasDropoff =
          Number.isFinite(activeIncomingOrder.dropoffLat ?? NaN) &&
          Number.isFinite(activeIncomingOrder.dropoffLng ?? NaN);

        const route = await fetchNavigationRoute(
          currentPoint,
          {
            latitude: hasDropoff
              ? Number(activeIncomingOrder.dropoffLat)
              : Number(activeIncomingOrder.pickupLat),
            longitude: hasDropoff
              ? Number(activeIncomingOrder.dropoffLng)
              : Number(activeIncomingOrder.pickupLng),
          },
          hasDropoff
            ? [
                {
                  latitude: Number(activeIncomingOrder.pickupLat),
                  longitude: Number(activeIncomingOrder.pickupLng),
                },
              ]
            : [],
        );

        if (cancelled) return;

        if (route) {
          setNavigationRoute(route);

          if (!followNavigationMode) {
            void fitCameraToRoute(cameraRef as any, route.geometry);
          }
        }
      } catch (e) {
        console.log("DriverMapScreen live reroute error:", e);
      } finally {
        if (!cancelled) {
          setNavigationRouteLoading(false);
        }

        rerouteInFlightRef.current = false;
      }
    }

    void rerouteLiveNavigation();

    return () => {
      cancelled = true;
    };
  }, [
    followNavigationMode,
    hasLocation,
    incomingOrder?.id,
    incomingOrder?.pickupLat,
    incomingOrder?.pickupLng,
    incomingOrder?.dropoffLat,
    incomingOrder?.dropoffLng,
    navigationRoute?.geometry,
    navigationRouteLoading,
    region.latitude,
    region.longitude,
  ]);

  useEffect(() => {
    if (!hasLocation) {
      previousDriverPointRef.current = null;
      return;
    }

    const currentPoint = {
      latitude: region.latitude,
      longitude: region.longitude,
    };
    const previousPoint = previousDriverPointRef.current;
    let nextHeading = driverHeading;

    if (previousPoint) {
      const movedMeters = distanceMeters(
        previousPoint.latitude,
        previousPoint.longitude,
        currentPoint.latitude,
        currentPoint.longitude,
      );

      if (movedMeters >= NAVIGATION_MIN_HEADING_DISTANCE_METERS) {
        nextHeading = calculateHeading(previousPoint, currentPoint);
        setDriverHeading((currentHeading) => {
          const delta = Math.abs(currentHeading - nextHeading);
          const wrappedDelta = Math.min(delta, 360 - delta);
          return wrappedDelta >= 2 ? nextHeading : currentHeading;
        });
      }
    }

    previousDriverPointRef.current = currentPoint;

    if (!followNavigationMode || !isNavigationActive || !cameraRef.current) {
      return;
    }

    const now = Date.now();
    if (now - lastFollowCameraAtRef.current < NAVIGATION_CAMERA_THROTTLE_MS) {
      return;
    }

    lastFollowCameraAtRef.current = now;

    try {
      (cameraRef.current as any).setCamera({
        centerCoordinate: [region.longitude, region.latitude],
        zoomLevel: NAVIGATION_FOLLOW_ZOOM,
        heading: nextHeading,
        pitch: NAVIGATION_FOLLOW_PITCH,
        animationMode: "easeTo",
        animationDuration: 700,
      });
    } catch (e) {
      console.log("DriverMapScreen follow camera error:", e);
    }
  }, [
    driverHeading,
    followNavigationMode,
    hasLocation,
    isNavigationActive,
    region.latitude,
    region.longitude,
  ]);

  function centerOnDriver() {
    if (!hasLocation) return;

    setFollowNavigationMode(true);

    (cameraRef.current as any)?.setCamera({
      centerCoordinate: [region.longitude, region.latitude],
      zoomLevel: isNavigationActive ? NAVIGATION_FOLLOW_ZOOM : 16,
      heading: isNavigationActive ? driverHeading : 0,
      pitch: isNavigationActive ? NAVIGATION_FOLLOW_PITCH : 0,
      animationDuration: 650,
      animationMode: "flyTo",
    });
  }

  async function handleAcceptIncomingOrder() {
    if (!incomingOrder || incomingActionLoading) return;

    if (!incomingOrder.offerId || !incomingOrder.sourceTable) {
      setIncomingOrder(null);
      setIncomingTimer(0);
      return;
    }

    try {
      setIncomingActionLoading(true);

      const rpcName =
        incomingOrder.sourceTable === "delivery_requests"
          ? "driver_accept_delivery_request_offer"
          : "driver_accept_order_offer";

      const { data, error } = await supabase.rpc(rpcName, {
        p_offer_id: incomingOrder.offerId,
      });

      if (error) throw error;

      const result = Array.isArray(data) ? data[0] : data;
      if (result && result.ok === false) {
        throw new Error(result.message ?? "offer_not_available");
      }

      const orderId =
        incomingOrder.sourceTable === "delivery_requests"
          ? result?.delivery_request_id ?? incomingOrder.id
          : result?.order_id ?? incomingOrder.id;

      setIncomingOrder(null);
      setIncomingTimer(0);
      await fetchDriverOrders();

      (navigation as any).navigate("DriverOrderDetails", {
        orderId,
        sourceTable: incomingOrder.sourceTable,
      });
    } catch (e: any) {
      console.log("Erreur accept incoming map:", e);
      Alert.alert(
        t("shared.orderChat.alerts.errorTitle", "Erreur"),
        e?.message ?? "Impossible d'accepter cette offre.",
      );
      void loadLatestIncomingOffer();
    } finally {
      setIncomingActionLoading(false);
    }
  }

  async function handleRejectIncomingOrder(reason: "reject" | "timeout") {
    if (!incomingOrder || incomingActionLoading) return;

    if (!incomingOrder.offerId || !incomingOrder.sourceTable) {
      setIncomingOrder(null);
      setIncomingTimer(0);
      return;
    }

    try {
      setIncomingActionLoading(true);

      const rpcName =
        incomingOrder.sourceTable === "delivery_requests"
          ? "driver_reject_delivery_request_offer"
          : "driver_reject_order_offer";

      const { data, error } = await supabase.rpc(rpcName, {
        p_offer_id: incomingOrder.offerId,
        p_reason: reason === "timeout" ? "timeout" : "driver_rejected",
      });

      if (error) throw error;

      const result = Array.isArray(data) ? data[0] : data;
      if (result && result.ok === false) {
        throw new Error(result.message ?? "offer_not_available");
      }

      setIncomingOrder(null);
      setIncomingTimer(0);
      await fetchDriverOrders();
    } catch (e: any) {
      console.log("Erreur reject incoming map:", e);
      if (reason !== "timeout") {
        Alert.alert(
          t("shared.orderChat.alerts.errorTitle", "Erreur"),
          e?.message ?? "Impossible de refuser cette offre.",
        );
      }
      void loadLatestIncomingOffer();
    } finally {
      setIncomingActionLoading(false);
    }
  }

  function triggerTestIncomingOrder() {
    const surgeLabel =
      currentZone &&
      (currentZone.activity === "busy" || currentZone.activity === "very_busy")
        ? currentZone.activity === "very_busy"
          ? "x1.6"
          : "x1.3"
        : null;

    const fakeOrder: IncomingOrderBanner = {
      id: "test-order",
      offerId: null,
      sourceTable: "orders",
      pickupLat: 40.6615,
      pickupLng: -73.9796,
      dropoffLat: 40.6501,
      dropoffLng: -73.9496,
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

  function handleOpenOrder(order: DriverOrder) {
    // Keep sourceTable for runtime support while avoiding a stale RootStackParamList
    // TypeScript error in this screen. DriverOrderDetailsScreen already supports it.
    (navigation as any).navigate("DriverOrderDetails", {
      orderId: order.id,
      sourceTable: order.source_table,
    });
  }

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
      case "paid_pending":
      case "processing_pending":
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
    if (kind === "delivery")
      return t("driver.map.kind.delivery", "MMD Delivery");

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
    const gain = getSafeDriverPayout(order);
    const statusColor =
      order.status === "delivered"
        ? "#22C55E"
        : order.status === "dispatched"
          ? "#FBBF24"
          : order.status === "accepted" ||
              order.status === "prepared" ||
              order.status === "ready"
            ? "#93C5FD"
            : order.status === "canceled"
              ? "#FB7185"
              : "#CBD5E1";

    return (
      <TouchableOpacity
        key={getOrderCompositeKey(order)}
        onPress={() => handleOpenOrder(order)}
        activeOpacity={0.9}
        style={{
          backgroundColor: "rgba(2,6,23,0.92)",
          borderRadius: 18,
          borderWidth: 1,
          borderColor: "rgba(51,65,85,0.95)",
          padding: 12,
          marginBottom: 10,
          shadowColor: "#000",
          shadowOpacity: 0.22,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 5 },
          elevation: 4,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            marginBottom: 4,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#F8FAFC", fontSize: 12, fontWeight: "700" }}>
            #{order.id.slice(0, 8)}
          </Text>

          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 999,
              backgroundColor: "rgba(15,23,42,0.9)",
              borderWidth: 1,
              borderColor: "rgba(71,85,105,0.95)",
            }}
          >
            <Text
              style={{
                color: statusColor,
                fontSize: 10,
                fontWeight: "800",
              }}
            >
              {formatStatus(order.status)}
            </Text>
          </View>
        </View>

        <Text
          style={{
            color: "#7DD3FC",
            fontSize: 12,
            fontWeight: "600",
            marginBottom: 3,
          }}
        >
          {formatKind(order.kind, order.restaurant_name)}
        </Text>

        <Text style={{ color: "#64748B", fontSize: 10, marginBottom: 8 }}>
          {formatDate(order.created_at)}
        </Text>

        <Text style={{ color: "#94A3B8", fontSize: 11 }} numberOfLines={1}>
          {t("driver.map.orderCard.pickupLabel")}{" "}
          <Text style={{ color: "#E2E8F0", fontWeight: "600" }}>
            {order.pickup_address ?? "—"}
          </Text>
        </Text>

        <Text
          style={{
            color: "#94A3B8",
            fontSize: 11,
            marginTop: 3,
            marginBottom: 8,
          }}
          numberOfLines={1}
        >
          {t("driver.map.orderCard.dropoffLabel")}{" "}
          <Text style={{ color: "#E2E8F0", fontWeight: "600" }}>
            {order.dropoff_address ?? "—"}
          </Text>
        </Text>

        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 6,
              borderRadius: 12,
              backgroundColor: "rgba(15,23,42,0.75)",
            }}
          >
            <Text style={{ color: "#94A3B8", fontSize: 10 }}>
              {t("driver.map.orderCard.distanceLabel")}{" "}
              <Text style={{ color: "#F8FAFC", fontWeight: "700" }}>
                {formatMiles(order.distance_miles)}
              </Text>
            </Text>
          </View>

          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 6,
              borderRadius: 12,
              backgroundColor: "rgba(5,46,22,0.45)",
            }}
          >
            <Text style={{ color: "#BBF7D0", fontSize: 10, fontWeight: "800" }}>
              {t("driver.map.orderCard.earningsLabel")} {formatMoney(gain)}
            </Text>
          </View>
        </View>

        <Text
          style={{
            marginTop: 10,
            color: "#60A5FA",
            fontSize: 11,
            fontWeight: "700",
            textAlign: "right",
          }}
        >
          {t("driver.map.myOrders.viewDetails")}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />

      <View style={{ flex: 1 }}>
        {loading && !hasLocation ? (
          <View
            style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
          >
            <View
              style={{
                paddingHorizontal: 22,
                paddingVertical: 18,
                borderRadius: 24,
                backgroundColor: "rgba(15,23,42,0.82)",
                borderWidth: 1,
                borderColor: "rgba(51,65,85,0.95)",
                alignItems: "center",
              }}
            >
              <ActivityIndicator size="large" color="#60A5FA" />

              <Text
                style={{
                  color: "#E2E8F0",
                  fontSize: 13,
                  marginTop: 10,
                  fontWeight: "700",
                }}
              >
                {t("driver.map.locating")}
              </Text>

              <Text style={{ color: "#94A3B8", fontSize: 11, marginTop: 4 }}>
                Positionnement sécurisé en cours...
              </Text>
            </View>
          </View>
        ) : (
          <>
            <Mapbox.MapView
              style={{ flex: 1 }}
              styleURL={mapStyleURL}
              logoEnabled={false}
              attributionEnabled={false}
              compassEnabled
              surfaceView={false}
            >
              <Mapbox.Camera
                ref={cameraRef}
                centerCoordinate={[region.longitude, region.latitude]}
                zoomLevel={regionToZoom(region)}
                animationMode="flyTo"
                animationDuration={650}
              />

              <Mapbox.UserLocation
                visible={false}
                showsUserHeadingIndicator={true}
              />

              {navigationRoute?.geometry && (
                <Mapbox.ShapeSource
                  id="driver-navigation-route-source"
                  shape={navigationRoute.geometry}
                >
                  <Mapbox.LineLayer
                    id="driver-navigation-route-casing"
                    style={{
                      lineColor: "rgba(15,23,42,0.86)",
                      lineWidth: 8,
                      lineCap: "round",
                      lineJoin: "round",
                    }}
                  />
                  <Mapbox.LineLayer
                    id="driver-navigation-route-line"
                    style={{
                      lineColor: "#2563EB",
                      lineWidth: 5,
                      lineCap: "round",
                      lineJoin: "round",
                    }}
                  />
                </Mapbox.ShapeSource>
              )}

              {hasLocation && (
                <Mapbox.PointAnnotation
                  id="driver-live-marker"
                  coordinate={[region.longitude, region.latitude]}
                >
                  <View
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 24,
                      backgroundColor: "#2563EB",
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 4,
                      borderColor: "#FFFFFF",
                      shadowColor: "#2563EB",
                      shadowOpacity: 0.45,
                      shadowRadius: 12,
                      shadowOffset: { width: 0, height: 5 },
                      elevation: 10,
                    }}
                  >
                    <Text
                      style={{
                        color: "#FFFFFF",
                        fontSize: 23,
                        fontWeight: "900",
                        transform: [{ rotate: `${driverHeading - 45}deg` }],
                        marginTop: -1,
                      }}
                    >
                      ➤
                    </Text>
                  </View>
                </Mapbox.PointAnnotation>
              )}

              {incomingOrder?.pickupLat != null && incomingOrder?.pickupLng != null && (
                <Mapbox.PointAnnotation
                  id="incoming-pickup-marker"
                  coordinate={[Number(incomingOrder.pickupLng), Number(incomingOrder.pickupLat)]}
                >
                  <View
                    style={{
                      paddingHorizontal: 9,
                      paddingVertical: 6,
                      borderRadius: 999,
                      backgroundColor: "#22C55E",
                      borderWidth: 2,
                      borderColor: "#FFFFFF",
                    }}
                  >
                    <Text style={{ color: "#052E16", fontSize: 10, fontWeight: "900" }}>
                      PICKUP
                    </Text>
                  </View>
                </Mapbox.PointAnnotation>
              )}

              {incomingOrder?.dropoffLat != null && incomingOrder?.dropoffLng != null && (
                <Mapbox.PointAnnotation
                  id="incoming-dropoff-marker"
                  coordinate={[Number(incomingOrder.dropoffLng), Number(incomingOrder.dropoffLat)]}
                >
                  <View
                    style={{
                      paddingHorizontal: 9,
                      paddingVertical: 6,
                      borderRadius: 999,
                      backgroundColor: "#F97316",
                      borderWidth: 2,
                      borderColor: "#FFFFFF",
                    }}
                  >
                    <Text style={{ color: "#431407", fontSize: 10, fontWeight: "900" }}>
                      DROPOFF
                    </Text>
                  </View>
                </Mapbox.PointAnnotation>
              )}

              {DRIVER_ZONES.map((zone) => {
                const { strokeColor, fillColor, labelColor, haloColor } =
                  getZoneColors(zone.activity);

                return (
                  <React.Fragment key={zone.id}>
                    <Mapbox.ShapeSource
                      id={`zone-source-${zone.id}`}
                      shape={zonePolygonToFeature(zone)}
                    >
                      <Mapbox.FillLayer
                        id={`zone-fill-${zone.id}`}
                        style={{
                          fillColor,
                          fillOpacity: 1,
                        }}
                      />

                      <Mapbox.LineLayer
                        id={`zone-line-${zone.id}`}
                        style={{
                          lineColor: strokeColor,
                          lineWidth: 2,
                        }}
                      />
                    </Mapbox.ShapeSource>
                  </React.Fragment>
                );
              })}

              {nearbyRestaurants.map((resto) => {
                const dist = hasLocation
                  ? distanceMeters(
                      region.latitude,
                      region.longitude,
                      resto.latitude,
                      resto.longitude,
                    )
                  : Infinity;

                const inBusyZone =
                  currentZone &&
                  (currentZone.activity === "busy" ||
                    currentZone.activity === "very_busy");

                const isClose = dist < 2500;
                const isBoosted = !!inBusyZone && isClose;

                const boostLabel =
                  isBoosted && currentZone
                    ? currentZone.activity === "very_busy"
                      ? "x1.6"
                      : "x1.3"
                    : null;

                return (
                  <Mapbox.PointAnnotation
                    key={resto.id}
                    id={`restaurant-${resto.id}`}
                    coordinate={[resto.longitude, resto.latitude]}
                  >
                    <View
                      style={{
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <View
                        style={{
                          width: isBoosted ? 48 : 42,
                          height: isBoosted ? 48 : 42,
                          borderRadius: isBoosted ? 24 : 21,
                          backgroundColor: "#FFFFFF",
                          borderWidth: isBoosted ? 3 : 2,
                          borderColor: isBoosted ? "#EA580C" : "#F97316",
                          alignItems: "center",
                          justifyContent: "center",
                          shadowColor: "#000",
                          shadowOpacity: isBoosted ? 0.34 : 0.2,
                          shadowRadius: isBoosted ? 10 : 7,
                          shadowOffset: { width: 0, height: 4 },
                          elevation: isBoosted ? 9 : 6,
                          overflow: "hidden",
                        }}
                      >
                        {resto.logoUrl ? (
                          <Image
                            source={{ uri: resto.logoUrl }}
                            style={{ width: "100%", height: "100%" }}
                            resizeMode="cover"
                          />
                        ) : (
                          <View
                            style={{
                              width: "100%",
                              height: "100%",
                              alignItems: "center",
                              justifyContent: "center",
                              backgroundColor: isBoosted
                                ? "#EA580C"
                                : "#F97316",
                            }}
                          >
                            <Text
                              style={{
                                color: "#FFFFFF",
                                fontSize: 15,
                                fontWeight: "900",
                              }}
                            >
                              {isBoosted ? "🔥" : "R"}
                            </Text>
                          </View>
                        )}
                      </View>

                      <View
                        style={{
                          marginTop: 4,
                          maxWidth: 110,
                          paddingHorizontal: 7,
                          paddingVertical: 3,
                          borderRadius: 999,
                          backgroundColor: "rgba(2,6,23,0.9)",
                          borderWidth: 1,
                          borderColor: isBoosted
                            ? "rgba(249,115,22,0.55)"
                            : "rgba(148,163,184,0.25)",
                          flexDirection: "row",
                          alignItems: "center",
                        }}
                      >
                        <Text
                          style={{
                            color: "#FFFFFF",
                            fontSize: 9,
                            fontWeight: "800",
                            maxWidth: boostLabel ? 72 : 96,
                          }}
                          numberOfLines={1}
                        >
                          {resto.name}
                        </Text>

                        {boostLabel && (
                          <Text
                            style={{
                              marginLeft: 4,
                              color: "#FDBA74",
                              fontSize: 9,
                              fontWeight: "900",
                            }}
                          >
                            {boostLabel}
                          </Text>
                        )}
                      </View>
                    </View>
                  </Mapbox.PointAnnotation>
                );
              })}
            </Mapbox.MapView>

            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 140,
                backgroundColor: "rgba(2,6,23,0.08)",
              }}
            />

            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: 82,
                left: 16,
                right: 16,
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 7,
                  borderRadius: 999,
                  backgroundColor: "rgba(15,23,42,0.86)",
                  borderWidth: 1,
                  borderColor: "rgba(71,85,105,0.55)",
                }}
              >
                <Text
                  style={{ color: "#94A3B8", fontSize: 10, fontWeight: "800" }}
                >
                  ZONE
                </Text>
                <Text
                  style={{
                    color: "#F8FAFC",
                    fontSize: 12,
                    fontWeight: "900",
                    marginTop: 2,
                  }}
                >
                  {currentZone?.name ?? "Live area"}
                </Text>
              </View>

              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 7,
                  borderRadius: 999,
                  backgroundColor: "rgba(15,23,42,0.86)",
                  borderWidth: 1,
                  borderColor: "rgba(71,85,105,0.55)",
                }}
              >
                <Text
                  style={{ color: "#94A3B8", fontSize: 10, fontWeight: "800" }}
                >
                  PREMIUM
                </Text>
                <Text
                  style={{
                    color: "#F8FAFC",
                    fontSize: 12,
                    fontWeight: "900",
                    marginTop: 2,
                  }}
                >
                  {zoneOpportunityLabel} · {zoneOpportunityScore}%
                </Text>
              </View>

              {boostLabelGlobal && (
                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    borderRadius: 999,
                    backgroundColor: "rgba(120,53,15,0.34)",
                    borderWidth: 1,
                    borderColor: "rgba(251,191,36,0.28)",
                  }}
                >
                  <Text
                    style={{
                      color: "#FCD34D",
                      fontSize: 10,
                      fontWeight: "800",
                    }}
                  >
                    BOOST
                  </Text>
                  <Text
                    style={{
                      color: "#FEF3C7",
                      fontSize: 12,
                      fontWeight: "900",
                      marginTop: 2,
                    }}
                  >
                    {boostLabelGlobal}
                  </Text>
                </View>
              )}
            </View>

            <Animated.View
              pointerEvents={incomingOrder ? "auto" : "none"}
              style={{
                position: "absolute",
                left: 12,
                right: 12,
                top: 92,
                opacity: incomingOpacity,
                transform: [{ translateY: incomingTranslateY }],
              }}
            >
              {incomingOrder && (
                <View
                  style={{
                    padding: 12,
                    borderRadius: 20,
                    backgroundColor: "rgba(15,23,42,0.985)",
                    borderWidth: 1,
                    borderColor: "#F97316",
                    shadowColor: "#000",
                    shadowOpacity: 0.44,
                    shadowRadius: 18,
                    shadowOffset: { width: 0, height: 6 },
                    elevation: 12,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 8,
                    }}
                  >
                    <View>
                      <Text
                        style={{
                          color: "#F8FAFC",
                          fontSize: 14,
                          fontWeight: "900",
                        }}
                      >
                        {t("driver.map.incoming.title")}
                      </Text>

                      <Text
                        style={{ color: "#94A3B8", fontSize: 10, marginTop: 2 }}
                      >
                        {navigationRouteLoading
                          ? "Calcul de la route live…"
                          : "Nouvelle opportunité premium"}
                      </Text>
                    </View>

                    <View
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 999,
                        backgroundColor: "rgba(17,24,39,0.98)",
                        borderWidth: 1,
                        borderColor: "#F97316",
                      }}
                    >
                      <Text
                        style={{
                          color: "#FDBA74",
                          fontSize: 11,
                          fontWeight: "900",
                        }}
                      >
                        {incomingTimer}s
                      </Text>
                    </View>
                  </View>

                  <Text
                    style={{
                      color: "#E5E7EB",
                      fontSize: 13,
                      fontWeight: "700",
                      marginBottom: 3,
                    }}
                  >
                    {incomingOrder.restaurantName}
                  </Text>

                  <Text
                    style={{ color: "#9CA3AF", fontSize: 11 }}
                    numberOfLines={1}
                  >
                    {t("driver.map.incoming.pickup")}{" "}
                    {incomingOrder.pickupAddress}
                  </Text>

                  <Text
                    style={{ color: "#9CA3AF", fontSize: 11, marginTop: 2 }}
                    numberOfLines={1}
                  >
                    {t("driver.map.incoming.dropoff")}{" "}
                    {incomingOrder.dropoffAddress}
                  </Text>

                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: 10,
                      marginBottom: 10,
                    }}
                  >
                    <View
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 7,
                        borderRadius: 14,
                        backgroundColor: "rgba(15,23,42,0.9)",
                      }}
                    >
                      <Text
                        style={{
                          color: "#F8FAFC",
                          fontSize: 12,
                          fontWeight: "700",
                        }}
                      >
                        {navigationRoute
                          ? `${(navigationRoute.distanceMeters / 1609.344).toFixed(1)} mi • ${navigationRoute.etaMinutes} min`
                          : `${incomingOrder.distanceMiles.toFixed(1)} mi • ${incomingOrder.etaMinutes} min`}
                      </Text>
                    </View>

                    <View
                      style={{ flexDirection: "row", alignItems: "center" }}
                    >
                      {incomingOrder.surgeLabel && (
                        <View
                          style={{
                            marginRight: 6,
                            paddingHorizontal: 7,
                            paddingVertical: 3,
                            borderRadius: 999,
                            backgroundColor: "#FEF3C7",
                          }}
                        >
                          <Text
                            style={{
                              color: "#B45309",
                              fontSize: 10,
                              fontWeight: "800",
                            }}
                          >
                            {incomingOrder.surgeLabel}
                          </Text>
                        </View>
                      )}

                      <View
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 14,
                          backgroundColor: "rgba(5,46,22,0.45)",
                        }}
                      >
                        <Text
                          style={{
                            color: "#BBF7D0",
                            fontSize: 13,
                            fontWeight: "900",
                          }}
                        >
                          {incomingOrder.price.toFixed(2)} $
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TouchableOpacity
                      onPress={() => handleRejectIncomingOrder("reject")}
                      activeOpacity={0.9}
                      disabled={incomingActionLoading}
                      style={{
                        flex: 1,
                        opacity: incomingActionLoading ? 0.6 : 1,
                        paddingVertical: 11,
                        borderRadius: 999,
                        backgroundColor: "#111827",
                        borderWidth: 1,
                        borderColor: "#FDA4AF",
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          color: "#FECDD3",
                          fontSize: 13,
                          fontWeight: "800",
                        }}
                      >
                        {t("driver.map.incoming.decline")}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={handleAcceptIncomingOrder}
                      activeOpacity={0.9}
                      disabled={incomingActionLoading}
                      style={{
                        flex: 1,
                        opacity: incomingActionLoading ? 0.6 : 1,
                        paddingVertical: 11,
                        borderRadius: 999,
                        backgroundColor: "#22C55E",
                        alignItems: "center",
                        shadowColor: "#22C55E",
                        shadowOpacity: 0.26,
                        shadowRadius: 10,
                        shadowOffset: { width: 0, height: 4 },
                      }}
                    >
                      <Text
                        style={{
                          color: "#052E16",
                          fontSize: 13,
                          fontWeight: "900",
                        }}
                      >
                        {t("driver.map.incoming.accept")}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </Animated.View>

            {restaurantsLoading && (
              <View
                style={{
                  position: "absolute",
                  left: 12,
                  top: 64,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: "rgba(15,23,42,0.92)",
                  borderWidth: 1,
                  borderColor: "rgba(51,65,85,0.95)",
                }}
              >
                <Text
                  style={{ color: "#CBD5E1", fontSize: 10, fontWeight: "700" }}
                >
                  {t("driver.map.restaurantsLoading")}
                </Text>
              </View>
            )}

            {hasLocation && (
              <View
                pointerEvents="box-none"
                style={{
                  position: "absolute",
                  right: 18,
                  bottom: 214,
                  zIndex: 9998,
                  elevation: 9998,
                }}
              >
                <TouchableOpacity
                  onPress={centerOnDriver}
                  activeOpacity={0.9}
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: 27,
                    backgroundColor: "rgba(255,255,255,0.96)",
                    alignItems: "center",
                    justifyContent: "center",
                    shadowColor: "#000",
                    shadowOpacity: 0.18,
                    shadowRadius: 14,
                    shadowOffset: { width: 0, height: 6 },
                    elevation: 12,
                  }}
                >
                  <Text
                    style={{
                      color: "#020617",
                      fontSize: 28,
                      fontWeight: "900",
                      transform: [{ rotate: "-45deg" }],
                      marginTop: -2,
                    }}
                  >
                    ➤
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            <Animated.View
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: sheetTop,
                paddingHorizontal: 12,
                paddingBottom: 24,
              }}
              {...panResponder.panHandlers}
            >
              <View
                style={{
                  borderRadius: 28,
                  paddingHorizontal: 16,
                  paddingTop: 10,
                  paddingBottom: 18,
                  backgroundColor: "rgba(15,23,42,0.97)",
                  borderWidth: 1,
                  borderColor: "rgba(51,65,85,0.95)",
                  shadowColor: "#000",
                  shadowOpacity: 0.42,
                  shadowRadius: 20,
                  shadowOffset: { width: 0, height: -4 },
                  elevation: 16,
                }}
              >
                <TouchableOpacity
                  onPress={() =>
                    animateSheet(
                      sheetState.current === "collapsed"
                        ? "expanded"
                        : "collapsed",
                    )
                  }
                  activeOpacity={0.7}
                  style={{ alignItems: "center", marginBottom: 12 }}
                >
                  <View
                    style={{
                      width: 48,
                      height: 5,
                      borderRadius: 999,
                      backgroundColor: "#475569",
                    }}
                  />
                </TouchableOpacity>

                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 10,
                  }}
                >
                  <View>
                    <Text
                      style={{
                        color: "#FFFFFF",
                        fontSize: 16,
                        fontWeight: "800",
                      }}
                    >
                      {t("driver.map.statusTitle")}
                    </Text>

                    <Text
                      style={{ color: "#64748B", fontSize: 10, marginTop: 2 }}
                    >
                      Mode détection premium
                    </Text>
                  </View>

                  <View
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: 999,
                      backgroundColor: isOnline
                        ? "rgba(5,46,22,0.7)"
                        : "rgba(69,10,10,0.65)",
                      borderWidth: 1,
                      borderColor: isOnline
                        ? "rgba(34,197,94,0.55)"
                        : "rgba(251,113,133,0.45)",
                    }}
                  >
                    <Text
                      style={{
                        color: isOnline ? "#86EFAC" : "#FECACA",
                        fontSize: 11,
                        fontWeight: "800",
                      }}
                    >
                      {statusTitle}
                    </Text>
                  </View>
                </View>

                <View
                  style={{
                    backgroundColor: sheetSummaryCardColor,
                    borderRadius: 20,
                    padding: 14,
                    borderWidth: 1,
                    borderColor: isOnline
                      ? "rgba(34,197,94,0.18)"
                      : "rgba(251,113,133,0.18)",
                  }}
                >
                  <Text
                    style={{
                      color: isOnline ? "#22C55E" : "#FB7185",
                      fontSize: 14,
                      fontWeight: "900",
                      marginBottom: 5,
                    }}
                  >
                    {isOnline
                      ? t("driver.map.statusOnlineTitle")
                      : t("driver.map.statusOfflineTitle")}
                  </Text>

                  <Text
                    style={{ color: "#E2E8F0", fontSize: 11, lineHeight: 17 }}
                  >
                    {statusSubtitle}
                  </Text>
                </View>

                <View
                  style={{
                    marginTop: 12,
                    flexDirection: "row",
                    gap: 10,
                  }}
                >
                  <View
                    style={{
                      flex: 1,
                      borderRadius: 18,
                      padding: 12,
                      backgroundColor: "rgba(15,23,42,0.72)",
                      borderWidth: 1,
                      borderColor: "rgba(51,65,85,0.6)",
                    }}
                  >
                    <Text
                      style={{
                        color: "#94A3B8",
                        fontSize: 10,
                        fontWeight: "700",
                      }}
                    >
                      OPPORTUNITY SCORE
                    </Text>

                    <Text
                      style={{
                        color: "#F8FAFC",
                        fontSize: 18,
                        fontWeight: "900",
                        marginTop: 4,
                      }}
                    >
                      {zoneOpportunityScore}%
                    </Text>

                    <Text
                      style={{
                        color: "#60A5FA",
                        fontSize: 11,
                        fontWeight: "700",
                        marginTop: 2,
                      }}
                    >
                      {zoneOpportunityLabel}
                    </Text>
                  </View>

                  <View
                    style={{
                      flex: 1,
                      borderRadius: 18,
                      padding: 12,
                      backgroundColor: "rgba(15,23,42,0.72)",
                      borderWidth: 1,
                      borderColor: "rgba(51,65,85,0.6)",
                    }}
                  >
                    <Text
                      style={{
                        color: "#94A3B8",
                        fontSize: 10,
                        fontWeight: "700",
                      }}
                    >
                      ACTIVE AREA
                    </Text>

                    <Text
                      style={{
                        color: "#F8FAFC",
                        fontSize: 16,
                        fontWeight: "900",
                        marginTop: 4,
                      }}
                    >
                      {currentZone?.name ?? "Live area"}
                    </Text>

                    <Text
                      style={{
                        color: currentZone
                          ? getZoneColors(currentZone.activity).labelColor
                          : "#A5B4FC",
                        fontSize: 11,
                        fontWeight: "700",
                        marginTop: 2,
                      }}
                    >
                      {currentZone
                        ? getActivityLabel(currentZone.activity)
                        : t("driver.map.zoneUnknown")}
                    </Text>
                  </View>
                </View>

                <View
                  style={{
                    marginTop: 14,
                    borderTopWidth: 1,
                    borderTopColor: "#1E293B",
                    paddingTop: 12,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: 10,
                    }}
                  >
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={{ color: "#94A3B8", fontSize: 11 }}>
                        {t("driver.map.zoneActivityTitle")}
                        {currentZone ? ` (${currentZone.name})` : ""}
                      </Text>

                      <Text
                        style={{
                          color: currentZone
                            ? getZoneColors(currentZone.activity).labelColor
                            : "#A5B4FC",
                          fontSize: 14,
                          fontWeight: "900",
                          marginTop: 3,
                        }}
                      >
                        {currentZone
                          ? getActivityLabel(currentZone.activity)
                          : t("driver.map.zoneUnknown")}
                      </Text>

                      {boostLabelGlobal && (
                        <View
                          style={{
                            marginTop: 7,
                            alignSelf: "flex-start",
                            paddingHorizontal: 9,
                            paddingVertical: 5,
                            borderRadius: 999,
                            backgroundColor: "rgba(120,53,15,0.32)",
                            borderWidth: 1,
                            borderColor: "rgba(251,191,36,0.25)",
                          }}
                        >
                          <Text
                            style={{
                              color: "#FBBF24",
                              fontSize: 11,
                              fontWeight: "800",
                            }}
                          >
                            {t("driver.map.bonusEstimated", {
                              boost: boostLabelGlobal,
                            })}
                          </Text>
                        </View>
                      )}
                    </View>

                    <View
                      style={{
                        minWidth: 106,
                        backgroundColor: "rgba(15,23,42,0.7)",
                        borderRadius: 16,
                        padding: 10,
                      }}
                    >
                      <Text
                        style={{
                          color: "#94A3B8",
                          fontSize: 11,
                          textAlign: "right",
                        }}
                      >
                        {t("driver.map.nextUpdateTitle")}
                      </Text>

                      <Text
                        style={{
                          color: "#F8FAFC",
                          fontSize: 13,
                          fontWeight: "700",
                          textAlign: "right",
                          marginTop: 3,
                        }}
                      >
                        {t("driver.map.updateIntervalOnline")}
                      </Text>
                    </View>
                  </View>

                  {IS_DEV && (
                    <View
                      style={{
                        marginTop: 12,
                        paddingTop: 10,
                        borderTopWidth: 1,
                        borderTopColor: "#1F2937",
                      }}
                    >
                      <TouchableOpacity
                        onPress={triggerTestIncomingOrder}
                        activeOpacity={0.85}
                        style={{
                          alignSelf: "center",
                          paddingHorizontal: 14,
                          paddingVertical: 8,
                          borderRadius: 999,
                          backgroundColor: "#0F172A",
                          borderWidth: 1,
                          borderColor: "#4B5563",
                        }}
                      >
                        <Text
                          style={{
                            color: "#CBD5E1",
                            fontSize: 11,
                            fontWeight: "700",
                          }}
                        >
                          {t("driver.map.debug.testIncomingOrder")}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                <View
                  style={{
                    marginTop: 16,
                    borderTopWidth: 1,
                    borderTopColor: "#1E293B",
                    paddingTop: 12,
                    maxHeight: 235,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 8,
                    }}
                  >
                    <View>
                      <Text
                        style={{
                          color: "#E5E7EB",
                          fontSize: 15,
                          fontWeight: "800",
                        }}
                      >
                        {t("driver.map.myOrders.title")}
                      </Text>

                      <Text
                        style={{ color: "#64748B", fontSize: 10, marginTop: 2 }}
                      >
                        Historique et commandes assignées
                      </Text>
                    </View>

                    <TouchableOpacity
                      onPress={() => void fetchDriverOrders()}
                      activeOpacity={0.85}
                      disabled={ordersLoading}
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 7,
                        borderRadius: 999,
                        backgroundColor: "rgba(15,23,42,0.8)",
                        borderWidth: 1,
                        borderColor: "rgba(59,130,246,0.45)",
                      }}
                    >
                      <Text
                        style={{
                          color: "#60A5FA",
                          fontSize: 11,
                          fontWeight: "800",
                        }}
                      >
                        {ordersLoading
                          ? t("driver.map.myOrders.loading")
                          : t("shared.common.refresh", "Rafraîchir")}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {ordersLoading && (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        marginBottom: 8,
                        paddingVertical: 8,
                      }}
                    >
                      <ActivityIndicator size="small" color="#FFFFFF" />

                      <Text
                        style={{
                          color: "#9CA3AF",
                          fontSize: 11,
                          marginLeft: 8,
                        }}
                      >
                        {t("driver.map.myOrders.loading")}
                      </Text>
                    </View>
                  )}

                  {ordersError && (
                    <View
                      style={{
                        marginBottom: 8,
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        borderRadius: 12,
                        backgroundColor: "rgba(127,29,29,0.28)",
                        borderWidth: 1,
                        borderColor: "rgba(251,113,133,0.25)",
                      }}
                    >
                      <Text
                        style={{
                          color: "#FECACA",
                          fontSize: 11,
                          fontWeight: "600",
                        }}
                      >
                        {ordersError}
                      </Text>
                    </View>
                  )}

                  <ScrollView
                    style={{ maxHeight: 172 }}
                    contentContainerStyle={{ paddingBottom: 4 }}
                    showsVerticalScrollIndicator={false}
                  >
                    {driverOrders.length === 0 && !ordersLoading ? (
                      <View
                        style={{
                          paddingVertical: 16,
                          paddingHorizontal: 12,
                          borderRadius: 18,
                          backgroundColor: "rgba(15,23,42,0.55)",
                        }}
                      >
                        <Text
                          style={{
                            color: "#CBD5E1",
                            fontSize: 12,
                            fontWeight: "700",
                          }}
                        >
                          {t("driver.map.myOrders.emptyTitle")}
                        </Text>

                        <Text
                          style={{
                            color: "#6B7280",
                            fontSize: 10,
                            marginTop: 4,
                          }}
                        >
                          {t("driver.map.myOrders.emptySubtitle")}
                        </Text>
                      </View>
                    ) : (
                      driverOrders.map((order) => renderOrderCard(order))
                    )}
                  </ScrollView>
                </View>
              </View>
            </Animated.View>

            {errorMsg && (
              <View
                style={{
                  position: "absolute",
                  top: 14,
                  left: 12,
                  right: 12,
                  paddingVertical: 9,
                  paddingHorizontal: 12,
                  borderRadius: 14,
                  backgroundColor: "rgba(127,29,29,0.96)",
                  borderWidth: 1,
                  borderColor: "rgba(251,113,133,0.3)",
                }}
              >
                <Text
                  style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "700" }}
                >
                  {errorMsg}
                </Text>
              </View>
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
