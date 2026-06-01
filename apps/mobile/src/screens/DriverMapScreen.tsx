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
  Image,
} from "react-native";
import Mapbox from "@rnmapbox/maps";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import * as Location from "expo-location";
import { useTranslation } from "react-i18next";
import { useKeepAwake } from "expo-keep-awake";
import { supabase } from "../lib/supabase";
import { getDriverOnlineStatus } from "../lib/driverStatus";
import {
  calculateHeading,
  fetchNavigationRoute,
  fitCameraToRoute,
  shouldReroute,
  type NavigationRoute,
} from "../lib/navigationService";
import { buildNavigationInstruction } from "../lib/navigationInstructions";
import {
  speakNavigation,
  stopNavigationVoice,
} from "../lib/navigationVoice";

type Nav = NativeStackNavigationProp<RootStackParamList, "DriverMap">;

type MapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

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

type OrderSourceTable = "orders" | "delivery_requests";
type DestinationStage = "pickup" | "dropoff";

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
  sourceTable: OrderSourceTable;
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
  isAcceptedTrip?: boolean;
  destinationStage?: DestinationStage | null;
};

const NAVIGATION_FOLLOW_ZOOM = 17.2;
const NAVIGATION_FOLLOW_PITCH = 56;
const NAVIGATION_CAMERA_THROTTLE_MS = 1100;
const NAVIGATION_MIN_HEADING_DISTANCE_METERS = 4;
const NAVIGATION_REROUTE_THRESHOLD_METERS = 110;
const NAVIGATION_REROUTE_COOLDOWN_MS = 12000;
const NAVIGATION_PICKUP_ARRIVAL_METERS = 80;
const NAVIGATION_DROPOFF_ARRIVAL_METERS = 90;
const NAVIGATION_PROGRESS_VOICE_MS = 30000;

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
      };
    case "busy":
      return {
        strokeColor: "rgba(249,115,22,0.95)",
        fillColor: "rgba(251,146,60,0.24)",
      };
    case "normal":
      return {
        strokeColor: "rgba(234,179,8,0.92)",
        fillColor: "rgba(250,204,21,0.20)",
      };
    case "calm":
    default:
      return {
        strokeColor: "rgba(34,197,94,0.90)",
        fillColor: "rgba(34,197,94,0.16)",
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

function regionToZoom(region: MapRegion): number {
  const delta = Math.max(region.latitudeDelta, region.longitudeDelta);
  const zoom = Math.log2(360 / Math.max(delta, 0.0001));
  return Math.max(3, Math.min(18, zoom));
}

function normalizeSourceTable(value: unknown): OrderSourceTable {
  return value === "delivery_requests" ? "delivery_requests" : "orders";
}

function normalizeDestinationStage(value: unknown): DestinationStage | null {
  return value === "dropoff" || value === "pickup" ? value : null;
}

function getDriverPayout(row: any) {
  const candidates = [
    row?.driver_delivery_payout,
    row?.driver_payout,
    row?.driver_amount,
    row?.driver_pay,
    row?.estimated_driver_payout,
    row?.driver_share_amount,
    row?.payout_amount,
  ];

  for (const candidate of candidates) {
    const value = numberOrNull(candidate);
    if (value != null) return value;
  }

  return 0;
}

function buildOrderBannerFromRow(params: {
  row: any;
  sourceTable: OrderSourceTable;
  destinationStage?: DestinationStage | null;
  isAcceptedTrip?: boolean;
}): IncomingOrderBanner {
  const { row, sourceTable, destinationStage = null, isAcceptedTrip = false } = params;
  const pickupLng = numberOrNull(row?.pickup_lng ?? row?.pickup_lon ?? row?.pickup_long ?? row?.pickup_longitude);
  const dropoffLng = numberOrNull(row?.dropoff_lng ?? row?.dropoff_lon ?? row?.dropoff_long ?? row?.dropoff_longitude);
  const kind = String(row?.kind ?? "").trim().toLowerCase();
  const isDeliveryRequest = sourceTable === "delivery_requests" || kind === "delivery";

  return {
    id: String(row?.id ?? ""),
    offerId: row?.offer_id ?? null,
    sourceTable,
    pickupLat: numberOrNull(row?.pickup_lat),
    pickupLng,
    dropoffLat: numberOrNull(row?.dropoff_lat),
    dropoffLng,
    restaurantName:
      String(row?.restaurant_name || "").trim() ||
      (isDeliveryRequest ? "MMD Delivery" : "Restaurant order"),
    pickupAddress: String(row?.pickup_address || "Pickup location"),
    dropoffAddress: String(row?.dropoff_address || "Dropoff location"),
    price: getDriverPayout(row),
    distanceMiles: numberOrNull(row?.distance_miles) ?? 0,
    etaMinutes: numberOrNull(row?.eta_minutes) ?? 0,
    surgeLabel: row?.surge_label ?? null,
    isAcceptedTrip,
    destinationStage,
  };
}

export default function DriverMapScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<any>();
  const { t } = useTranslation();

  useKeepAwake();

  const routeParams = route.params ?? {};
  const routeOrderId = String(routeParams?.orderId ?? routeParams?.order_id ?? "").trim();
  const routeSourceTable = normalizeSourceTable(routeParams?.sourceTable ?? routeParams?.source_table);
  const routeDestinationStage = normalizeDestinationStage(routeParams?.destinationStage ?? routeParams?.destination_stage);

  const [region, setRegion] = useState<MapRegion>({
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
  const [incomingOrder, setIncomingOrder] = useState<IncomingOrderBanner | null>(null);
  const [incomingTimer, setIncomingTimer] = useState(0);
  const [incomingActionLoading, setIncomingActionLoading] = useState(false);
  const [navigationRoute, setNavigationRoute] = useState<NavigationRoute | null>(null);
  const [navigationRouteLoading, setNavigationRouteLoading] = useState(false);
  const [driverHeading, setDriverHeading] = useState(0);
  const [followNavigationMode, setFollowNavigationMode] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [isNightMode, setIsNightMode] = useState(false);

  const cameraRef = useRef<Mapbox.Camera | null>(null);
  const locationSubscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const hasCenteredOnDriverRef = useRef(false);
  const previousDriverPointRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const lastFollowCameraAtRef = useRef(0);
  const lastRerouteAtRef = useRef(0);
  const rerouteInFlightRef = useRef(false);
  const lastNavigationVoiceAtRef = useRef(0);
  const lastNavigationVoiceKeyRef = useRef<string | null>(null);
  const pickupArrivalAnnouncedRef = useRef(false);
  const dropoffArrivalAnnouncedRef = useRef(false);
  const routeRecalculatedAnnouncedRef = useRef(false);

  const incomingTranslateY = useRef(new Animated.Value(-18)).current;
  const incomingOpacity = useRef(new Animated.Value(0)).current;

  const mapStyleURL = isNightMode ? MAP_STYLE_DARK : MAP_STYLE_STREETS;
  const isAcceptedTripMode = Boolean(routeOrderId && incomingOrder?.isAcceptedTrip);
  const isOfferMode = Boolean(incomingOrder && !incomingOrder.isAcceptedTrip && incomingOrder.offerId);
  const isNavigationActive = Boolean(incomingOrder && navigationRoute?.geometry);

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

  useFocusEffect(
    useCallback(() => {
      let active = true;

      void (async () => {
        try {
          const savedOnline = await getDriverOnlineStatus();
          if (active) setIsOnline(savedOnline);
        } catch (e) {
          if (IS_DEV) {
            console.log("DriverMapScreen online status sync warning:", e);
          }
        }
      })();

      return () => {
        active = false;
      };
    }, []),
  );

  const statusTitle = isOnline
    ? t("driver.map.online", "ONLINE")
    : t("driver.map.offline", "OFFLINE");

  const navigationStage = useMemo<DestinationStage>(() => {
    if (incomingOrder?.destinationStage) {
      return incomingOrder.destinationStage;
    }

    if (!incomingOrder || !hasLocation) {
      return "pickup";
    }

    if (
      Number.isFinite(incomingOrder.pickupLat ?? NaN) &&
      Number.isFinite(incomingOrder.pickupLng ?? NaN)
    ) {
      const pickupDistance = distanceMeters(
        region.latitude,
        region.longitude,
        Number(incomingOrder.pickupLat),
        Number(incomingOrder.pickupLng),
      );

      if (pickupDistance <= NAVIGATION_PICKUP_ARRIVAL_METERS) {
        return "dropoff";
      }
    }

    return "pickup";
  }, [
    hasLocation,
    incomingOrder?.destinationStage,
    incomingOrder?.id,
    incomingOrder?.pickupLat,
    incomingOrder?.pickupLng,
    region.latitude,
    region.longitude,
  ]);

  const navigationInstruction = useMemo(() => {
    if (!incomingOrder || !navigationRoute) {
      return null;
    }

    return buildNavigationInstruction(
      navigationRoute.distanceMeters,
      navigationStage,
    );
  }, [incomingOrder, navigationRoute?.distanceMeters, navigationStage]);

  const locateDriver = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMsg(null);

      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        setErrorMsg(t("driver.map.permissionDenied", "Permission GPS refusée."));
        setLoading(false);
        return;
      }

      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

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
      if (IS_DEV) console.log("Erreur DriverMapScreen:", e);
      setErrorMsg(e?.message ?? t("driver.map.permissionDenied", "Permission GPS refusée."));
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
    return () => {
      void stopNavigationVoice();
    };
  }, []);

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
    if (!incomingOrder) {
      pickupArrivalAnnouncedRef.current = false;
      dropoffArrivalAnnouncedRef.current = false;
      routeRecalculatedAnnouncedRef.current = false;
      lastNavigationVoiceAtRef.current = 0;
      lastNavigationVoiceKeyRef.current = null;
      void stopNavigationVoice();
      return;
    }

    pickupArrivalAnnouncedRef.current = false;
    dropoffArrivalAnnouncedRef.current = false;
    routeRecalculatedAnnouncedRef.current = false;
    lastNavigationVoiceAtRef.current = 0;
    lastNavigationVoiceKeyRef.current = null;
  }, [incomingOrder?.id, incomingOrder?.sourceTable]);

  useEffect(() => {
    let cancelled = false;

    async function loadDriver() {
      try {
        const { data, error } = await supabase.auth.getUser();

        if (error || !data?.user) {
          if (IS_DEV) console.log("Impossible de récupérer l'utilisateur driver", error);
          return;
        }

        if (!cancelled) {
          setDriverId(data.user.id);
        }
      } catch (e) {
        if (IS_DEV) console.log("Erreur loadDriver:", e);
      }
    }

    void loadDriver();

    return () => {
      cancelled = true;
    };
  }, []);

  const loadRouteOrder = useCallback(async () => {
    if (!routeOrderId) return;

    try {
      const table = routeSourceTable;

      const result: any =
        table === "delivery_requests"
          ? await supabase
              .from("delivery_requests")
              .select(
                "id,status,created_at,pickup_address,dropoff_address,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,distance_miles,eta_minutes,driver_delivery_payout",
              )
              .eq("id", routeOrderId)
              .maybeSingle()
          : await supabase
              .from("orders")
              .select(
                "id,kind,status,created_at,restaurant_name,pickup_address,dropoff_address,pickup_lat,pickup_lng,pickup_lon,dropoff_lat,dropoff_lng,dropoff_lon,distance_miles,eta_minutes,driver_delivery_payout",
              )
              .eq("id", routeOrderId)
              .maybeSingle();

      const { data, error } = result;

      if (error) throw error;

      if (!data) {
        setErrorMsg(t("driver.map.orderNotFound", "Course introuvable."));
        return;
      }

      setIncomingOrder(
        buildOrderBannerFromRow({
          row: data,
          sourceTable: table,
          destinationStage: routeDestinationStage,
          isAcceptedTrip: true,
        }),
      );
    } catch (e: any) {
      if (IS_DEV) console.log("DriverMapScreen route order load error:", e);
      setErrorMsg(e?.message ?? t("driver.map.orderLoadError", "Impossible de charger la course."));
    }
  }, [routeDestinationStage, routeOrderId, routeSourceTable, t]);

  useEffect(() => {
    void loadRouteOrder();
  }, [loadRouteOrder]);

  const loadLatestIncomingOffer = useCallback(async () => {
    if (!driverId || routeOrderId) return;

    try {
      const nowIso = new Date().toISOString();

      const { data: orderOffers, error: orderOfferError } = await supabase
        .from("driver_order_offers")
        .select(
          "id, order_id, restaurant_name, pickup_address, dropoff_address, driver_price_cents, distance_miles, eta_minutes, surge_label, status, expires_at",
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
          .select("id,kind,status,restaurant_name,pickup_address,dropoff_address,pickup_lat,pickup_lng,pickup_lon,dropoff_lat,dropoff_lng,dropoff_lon,distance_miles,eta_minutes,driver_delivery_payout")
          .eq("id", orderOffer.order_id)
          .maybeSingle();

        if (orderRouteError && IS_DEV) {
          console.log("Driver map order route warning:", orderRouteError);
        }

        setIncomingOrder({
          ...buildOrderBannerFromRow({
            row: {
              ...(orderRouteRow ?? {}),
              id: orderOffer.order_id,
              restaurant_name: orderOffer.restaurant_name,
              pickup_address: orderOffer.pickup_address,
              dropoff_address: orderOffer.dropoff_address,
              driver_delivery_payout:
                typeof orderOffer.driver_price_cents === "number"
                  ? orderOffer.driver_price_cents / 100
                  : 0,
              distance_miles: orderOffer.distance_miles,
              eta_minutes: orderOffer.eta_minutes,
              surge_label: orderOffer.surge_label,
            },
            sourceTable: "orders",
          }),
          offerId: String(orderOffer.id),
          isAcceptedTrip: false,
        });
        setIncomingTimer(secondsLeft);
        return;
      }

      const { data: deliveryOffers, error: deliveryOfferError } = await supabase
        .from("delivery_request_driver_offers")
        .select("id, delivery_request_id, status, expires_at")
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
        ...buildOrderBannerFromRow({
          row: request,
          sourceTable: "delivery_requests",
        }),
        offerId: String(deliveryOffer.id),
        isAcceptedTrip: false,
      });
      setIncomingTimer(secondsLeft);
    } catch (e) {
      if (IS_DEV) console.log("Erreur chargement incoming offer map:", e);
    }
  }, [driverId, routeOrderId]);

  useEffect(() => {
    if (!driverId || routeOrderId) return;

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
  }, [driverId, loadLatestIncomingOffer, routeOrderId]);

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
          if (IS_DEV) console.log("Erreur chargement restaurants:", response.error);

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
        if (IS_DEV) console.log("Exception loadRestaurants:", e);

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
    if (!incomingOrder || incomingOrder.isAcceptedTrip) return;

    if (incomingTimer <= 0) {
      void handleRejectIncomingOrder("timeout");
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

      const hasPickup =
        Number.isFinite(incomingOrder.pickupLat ?? NaN) &&
        Number.isFinite(incomingOrder.pickupLng ?? NaN);
      const hasDropoff =
        Number.isFinite(incomingOrder.dropoffLat ?? NaN) &&
        Number.isFinite(incomingOrder.dropoffLng ?? NaN);

      if (!hasPickup && !hasDropoff) {
        setNavigationRoute(null);
        setNavigationRouteLoading(false);
        return;
      }

      const shouldNavigateToDropoff = navigationStage === "dropoff" && hasDropoff;
      const destination = shouldNavigateToDropoff
        ? {
            latitude: Number(incomingOrder.dropoffLat),
            longitude: Number(incomingOrder.dropoffLng),
          }
        : {
            latitude: Number(incomingOrder.pickupLat),
            longitude: Number(incomingOrder.pickupLng),
          };

      try {
        setNavigationRouteLoading(true);

        const route = await fetchNavigationRoute(
          { latitude: region.latitude, longitude: region.longitude },
          destination,
          [],
        );

        if (cancelled) return;

        setNavigationRoute(route);
        lastRerouteAtRef.current = Date.now();

        if (route) {
          void fitCameraToRoute(cameraRef as any, route.geometry);
        }
      } catch (e) {
        if (IS_DEV) console.log("DriverMapScreen navigation route error:", e);
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
    navigationStage,
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
    const activeOrder = incomingOrder;

    async function rerouteLiveNavigation() {
      try {
        rerouteInFlightRef.current = true;
        lastRerouteAtRef.current = Date.now();
        setNavigationRouteLoading(true);

        const shouldNavigateToDropoff =
          navigationStage === "dropoff" &&
          Number.isFinite(activeOrder.dropoffLat ?? NaN) &&
          Number.isFinite(activeOrder.dropoffLng ?? NaN);

        const destination = shouldNavigateToDropoff
          ? {
              latitude: Number(activeOrder.dropoffLat),
              longitude: Number(activeOrder.dropoffLng),
            }
          : {
              latitude: Number(activeOrder.pickupLat),
              longitude: Number(activeOrder.pickupLng),
            };

        const route = await fetchNavigationRoute(currentPoint, destination, []);

        if (cancelled) return;

        if (route) {
          setNavigationRoute(route);

          if (voiceEnabled) {
            if (!routeRecalculatedAnnouncedRef.current) {
              routeRecalculatedAnnouncedRef.current = true;
              void speakNavigation("Route recalculated", true);
            } else {
              void speakNavigation("Route recalculated");
            }
          }

          if (!followNavigationMode) {
            void fitCameraToRoute(cameraRef as any, route.geometry);
          }
        }
      } catch (e) {
        if (IS_DEV) console.log("DriverMapScreen live reroute error:", e);
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
    navigationStage,
    region.latitude,
    region.longitude,
    voiceEnabled,
  ]);

  useEffect(() => {
    if (!incomingOrder || !hasLocation || !navigationInstruction || !voiceEnabled) {
      return;
    }

    const now = Date.now();

    const hasPickup =
      Number.isFinite(incomingOrder.pickupLat ?? NaN) &&
      Number.isFinite(incomingOrder.pickupLng ?? NaN);

    const hasDropoff =
      Number.isFinite(incomingOrder.dropoffLat ?? NaN) &&
      Number.isFinite(incomingOrder.dropoffLng ?? NaN);

    if (hasPickup) {
      const pickupDistance = distanceMeters(
        region.latitude,
        region.longitude,
        Number(incomingOrder.pickupLat),
        Number(incomingOrder.pickupLng),
      );

      if (
        pickupDistance <= NAVIGATION_PICKUP_ARRIVAL_METERS &&
        !pickupArrivalAnnouncedRef.current
      ) {
        pickupArrivalAnnouncedRef.current = true;
        lastNavigationVoiceAtRef.current = now;
        lastNavigationVoiceKeyRef.current = "arrived-pickup";
        void speakNavigation("Arriving at pickup location", true);
        return;
      }
    }

    if (hasDropoff && navigationStage === "dropoff") {
      const dropoffDistance = distanceMeters(
        region.latitude,
        region.longitude,
        Number(incomingOrder.dropoffLat),
        Number(incomingOrder.dropoffLng),
      );

      if (
        dropoffDistance <= NAVIGATION_DROPOFF_ARRIVAL_METERS &&
        !dropoffArrivalAnnouncedRef.current
      ) {
        dropoffArrivalAnnouncedRef.current = true;
        lastNavigationVoiceAtRef.current = now;
        lastNavigationVoiceKeyRef.current = "arrived-dropoff";
        void speakNavigation("Arriving at destination", true);
        return;
      }
    }

    const voiceKey =
      navigationStage === "pickup"
        ? "continue-pickup"
        : "continue-dropoff";

    if (
      lastNavigationVoiceKeyRef.current !== voiceKey ||
      now - lastNavigationVoiceAtRef.current >= NAVIGATION_PROGRESS_VOICE_MS
    ) {
      lastNavigationVoiceKeyRef.current = voiceKey;
      lastNavigationVoiceAtRef.current = now;

      void speakNavigation(
        navigationStage === "pickup"
          ? "Continue to pickup location"
          : "Continue to dropoff location",
      );
    }
  }, [
    hasLocation,
    incomingOrder?.id,
    incomingOrder?.pickupLat,
    incomingOrder?.pickupLng,
    incomingOrder?.dropoffLat,
    incomingOrder?.dropoffLng,
    navigationInstruction,
    navigationStage,
    region.latitude,
    region.longitude,
    voiceEnabled,
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
      if (IS_DEV) console.log("DriverMapScreen follow camera error:", e);
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
    if (!incomingOrder || incomingActionLoading || incomingOrder.isAcceptedTrip) return;

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

      const acceptedTrip = {
        ...incomingOrder,
        id: String(orderId),
        offerId: null,
        isAcceptedTrip: true,
        destinationStage: "pickup" as DestinationStage,
      };

      setIncomingOrder(acceptedTrip);
      setIncomingTimer(0);
      setFollowNavigationMode(true);

      Alert.alert(
        t("driver.map.acceptedTitle", "Course acceptée ✅"),
        t("driver.map.acceptedBody", "Navigation MMD démarrée vers le pickup."),
      );
    } catch (e: any) {
      if (IS_DEV) console.log("Erreur accept incoming map:", e);
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
    if (!incomingOrder || incomingActionLoading || incomingOrder.isAcceptedTrip) return;

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
    } catch (e: any) {
      if (IS_DEV) console.log("Erreur reject incoming map:", e);
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

  function openOrderDetails() {
    if (!incomingOrder) return;

    (navigation as any).navigate("DriverOrderDetails", {
      orderId: incomingOrder.id,
      sourceTable: incomingOrder.sourceTable,
    });
  }

  function toggleVoice() {
    setVoiceEnabled((current) => {
      const next = !current;
      if (!next) {
        void stopNavigationVoice();
      }
      return next;
    });
  }

  function reportNavigationIssue() {
    Alert.alert(
      t("driver.map.report.title", "Signaler"),
      t("driver.map.report.body", "Le signalement navigation sera disponible dans une prochaine mise à jour."),
    );
  }

  const routeDistanceText = navigationRoute?.distanceMeters
    ? `${(navigationRoute.distanceMeters / 1609.344).toFixed(1)} mi`
    : incomingOrder?.distanceMiles
      ? `${incomingOrder.distanceMiles.toFixed(1)} mi`
      : "—";

  const routeEtaText = navigationRoute?.etaMinutes
    ? `${Math.round(navigationRoute.etaMinutes)} min`
    : incomingOrder?.etaMinutes
      ? `${Math.round(incomingOrder.etaMinutes)} min`
      : "—";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />

      <View style={{ flex: 1 }}>
        {loading && !hasLocation ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
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
              <Text style={{ color: "#E2E8F0", fontSize: 13, marginTop: 10, fontWeight: "700" }}>
                {t("driver.map.locating", "Localisation du chauffeur…")}
              </Text>
              <Text style={{ color: "#94A3B8", fontSize: 11, marginTop: 4 }}>
                {t("driver.map.locatingSecure", "Positionnement sécurisé en cours...")}
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
              onTouchStart={() => setFollowNavigationMode(false)}
            >
              <Mapbox.Camera
                ref={cameraRef}
                centerCoordinate={[region.longitude, region.latitude]}
                zoomLevel={regionToZoom(region)}
                animationMode="flyTo"
                animationDuration={650}
              />

              <Mapbox.UserLocation visible={false} showsUserHeadingIndicator />

              {DRIVER_ZONES.map((zone) => {
                const { strokeColor, fillColor } = getZoneColors(zone.activity);

                return (
                  <Mapbox.ShapeSource
                    key={zone.id}
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

                const isBoosted = !!inBusyZone && dist < 2500;

                return (
                  <Mapbox.PointAnnotation
                    key={resto.id}
                    id={`restaurant-${resto.id}`}
                    coordinate={[resto.longitude, resto.latitude]}
                  >
                    <View style={{ alignItems: "center", justifyContent: "center" }}>
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
                              backgroundColor: isBoosted ? "#EA580C" : "#F97316",
                            }}
                          >
                            <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "900" }}>
                              {isBoosted ? "🔥" : "R"}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </Mapbox.PointAnnotation>
                );
              })}

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
            </Mapbox.MapView>

            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 150,
                backgroundColor: "rgba(2,6,23,0.06)",
              }}
            />

            <View
              style={{
                position: "absolute",
                top: 44,
                left: 16,
                right: 16,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <TouchableOpacity
                onPress={() => navigation.goBack()}
                activeOpacity={0.85}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(2,6,23,0.9)",
                  borderWidth: 1,
                  borderColor: "rgba(148,163,184,0.22)",
                }}
              >
                <Text style={{ color: "#FFFFFF", fontSize: 22, fontWeight: "900" }}>‹</Text>
              </TouchableOpacity>

              <View
                pointerEvents="none"
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: isOnline
                    ? "rgba(5,46,22,0.88)"
                    : "rgba(69,10,10,0.82)",
                  borderWidth: 1,
                  borderColor: isOnline
                    ? "rgba(34,197,94,0.58)"
                    : "rgba(251,113,133,0.48)",
                }}
              >
                <Text
                  style={{
                    color: isOnline ? "#86EFAC" : "#FECACA",
                    fontSize: 11,
                    fontWeight: "900",
                    letterSpacing: 0.4,
                  }}
                >
                  {statusTitle}
                </Text>
              </View>
            </View>

            {restaurantsLoading && (
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: 16,
                  top: 96,
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: 999,
                  backgroundColor: "rgba(15,23,42,0.92)",
                  borderWidth: 1,
                  borderColor: "rgba(51,65,85,0.95)",
                }}
              >
                <Text style={{ color: "#CBD5E1", fontSize: 10, fontWeight: "800" }}>
                  {t("driver.map.restaurantsLoading", "Chargement restaurants...")}
                </Text>
              </View>
            )}

            {navigationInstruction && (
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  top: 96,
                  left: 14,
                  right: 14,
                  borderRadius: 24,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  backgroundColor: "rgba(2,6,23,0.96)",
                  borderWidth: 1,
                  borderColor: "rgba(96,165,250,0.42)",
                  shadowColor: "#000",
                  shadowOpacity: 0.34,
                  shadowRadius: 18,
                  shadowOffset: { width: 0, height: 8 },
                  elevation: 14,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={{ color: "#93C5FD", fontSize: 11, fontWeight: "900", letterSpacing: 0.5 }}>
                      {navigationStage === "pickup"
                        ? t("driver.map.navigation.toPickup", "VERS LE PICKUP")
                        : t("driver.map.navigation.toDropoff", "VERS LE DROPOFF")}
                    </Text>
                    <Text style={{ color: "#FFFFFF", fontSize: 18, fontWeight: "900", marginTop: 3 }}>
                      {navigationInstruction.title}
                    </Text>
                    <Text style={{ color: "#CBD5E1", fontSize: 12, marginTop: 4 }} numberOfLines={2}>
                      {navigationInstruction.subtitle}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ color: "#FFFFFF", fontSize: 18, fontWeight: "900" }}>{routeEtaText}</Text>
                    <Text style={{ color: "#93C5FD", fontSize: 12, fontWeight: "800", marginTop: 3 }}>{routeDistanceText}</Text>
                  </View>
                </View>
              </View>
            )}

            {navigationRouteLoading && (
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  top: navigationInstruction ? 205 : 100,
                  alignSelf: "center",
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: "rgba(15,23,42,0.92)",
                  borderWidth: 1,
                  borderColor: "rgba(96,165,250,0.34)",
                  flexDirection: "row",
                  alignItems: "center",
                }}
              >
                <ActivityIndicator size="small" color="#93C5FD" />
                <Text style={{ color: "#DBEAFE", fontSize: 12, fontWeight: "800", marginLeft: 8 }}>
                  {t("driver.map.navigation.calculating", "Calcul de la route…")}
                </Text>
              </View>
            )}

            <View
              style={{
                position: "absolute",
                right: 14,
                top: navigationInstruction ? 238 : 112,
                alignItems: "center",
              }}
            >
              <TouchableOpacity
                onPress={centerOnDriver}
                activeOpacity={0.86}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 26,
                  backgroundColor: "rgba(255,255,255,0.96)",
                  alignItems: "center",
                  justifyContent: "center",
                  shadowColor: "#000",
                  shadowOpacity: 0.22,
                  shadowRadius: 10,
                  shadowOffset: { width: 0, height: 5 },
                  elevation: 8,
                  marginBottom: 10,
                }}
              >
                <Text style={{ color: "#020617", fontSize: 22, fontWeight: "900" }}>⌖</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={toggleVoice}
                activeOpacity={0.86}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 26,
                  backgroundColor: voiceEnabled ? "rgba(2,6,23,0.92)" : "rgba(127,29,29,0.92)",
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: voiceEnabled ? "rgba(148,163,184,0.22)" : "rgba(251,113,133,0.34)",
                  marginBottom: 10,
                }}
              >
                <Text style={{ color: "#FFFFFF", fontSize: 20, fontWeight: "900" }}>{voiceEnabled ? "🔊" : "🔇"}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={reportNavigationIssue}
                activeOpacity={0.86}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 26,
                  backgroundColor: "rgba(2,6,23,0.92)",
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: "rgba(148,163,184,0.22)",
                }}
              >
                <Text style={{ color: "#FFFFFF", fontSize: 20, fontWeight: "900" }}>!</Text>
              </TouchableOpacity>
            </View>

            {incomingOrder && isOfferMode && (
              <Animated.View
                pointerEvents="auto"
                style={{
                  position: "absolute",
                  left: 14,
                  right: 14,
                  bottom: 22,
                  opacity: incomingOpacity,
                  transform: [{ translateY: incomingTranslateY }],
                }}
              >
                <View
                  style={{
                    borderRadius: 28,
                    padding: 16,
                    backgroundColor: "rgba(2,6,23,0.97)",
                    borderWidth: 1,
                    borderColor: "rgba(96,165,250,0.35)",
                    shadowColor: "#000",
                    shadowOpacity: 0.35,
                    shadowRadius: 22,
                    shadowOffset: { width: 0, height: 10 },
                    elevation: 18,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={{ color: "#93C5FD", fontSize: 12, fontWeight: "900", letterSpacing: 0.4 }}>
                        {t("driver.map.offer.title", "NOUVELLE COURSE")}
                      </Text>
                      <Text style={{ color: "#FFFFFF", fontSize: 18, fontWeight: "900", marginTop: 4 }} numberOfLines={1}>
                        {incomingOrder.restaurantName}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ color: "#F97316", fontSize: 22, fontWeight: "900" }}>{incomingTimer}s</Text>
                      <Text style={{ color: "#86EFAC", fontSize: 16, fontWeight: "900", marginTop: 2 }}>
                        {formatMoney(incomingOrder.price)}
                      </Text>
                    </View>
                  </View>

                  <View style={{ marginTop: 12 }}>
                    <Text style={{ color: "#94A3B8", fontSize: 12 }} numberOfLines={1}>
                      Pickup: <Text style={{ color: "#E2E8F0", fontWeight: "800" }}>{incomingOrder.pickupAddress}</Text>
                    </Text>
                    <Text style={{ color: "#94A3B8", fontSize: 12, marginTop: 6 }} numberOfLines={1}>
                      Dropoff: <Text style={{ color: "#E2E8F0", fontWeight: "800" }}>{incomingOrder.dropoffAddress}</Text>
                    </Text>
                  </View>

                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
                    <Text style={{ color: "#CBD5E1", fontSize: 12, fontWeight: "800" }}>
                      {incomingOrder.distanceMiles.toFixed(1)} mi • {incomingOrder.etaMinutes} min
                    </Text>
                    {incomingOrder.surgeLabel && (
                      <View style={{ paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: "rgba(249,115,22,0.16)" }}>
                        <Text style={{ color: "#FDBA74", fontSize: 11, fontWeight: "900" }}>{incomingOrder.surgeLabel}</Text>
                      </View>
                    )}
                  </View>

                  <View style={{ flexDirection: "row", marginTop: 14 }}>
                    <TouchableOpacity
                      onPress={() => void handleRejectIncomingOrder("reject")}
                      disabled={incomingActionLoading}
                      activeOpacity={0.86}
                      style={{
                        flex: 1,
                        borderRadius: 999,
                        paddingVertical: 13,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: "#EF4444",
                        marginRight: 10,
                        opacity: incomingActionLoading ? 0.65 : 1,
                      }}
                    >
                      <Text style={{ color: "#FFFFFF", fontSize: 14, fontWeight: "900" }}>
                        {t("driver.map.offer.ignore", "Ignore")}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => void handleAcceptIncomingOrder()}
                      disabled={incomingActionLoading}
                      activeOpacity={0.86}
                      style={{
                        flex: 1,
                        borderRadius: 999,
                        paddingVertical: 13,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: "#22C55E",
                        opacity: incomingActionLoading ? 0.65 : 1,
                      }}
                    >
                      <Text style={{ color: "#022C22", fontSize: 14, fontWeight: "900" }}>
                        {incomingActionLoading
                          ? t("driver.map.offer.accepting", "Accepting...")
                          : t("driver.map.offer.accept", "Accept")}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </Animated.View>
            )}

            {incomingOrder && isAcceptedTripMode && (
              <View
                style={{
                  position: "absolute",
                  left: 14,
                  right: 14,
                  bottom: 22,
                  borderRadius: 26,
                  padding: 14,
                  backgroundColor: "rgba(2,6,23,0.96)",
                  borderWidth: 1,
                  borderColor: "rgba(96,165,250,0.32)",
                  shadowColor: "#000",
                  shadowOpacity: 0.28,
                  shadowRadius: 18,
                  shadowOffset: { width: 0, height: 8 },
                  elevation: 14,
                }}
              >
                <TouchableOpacity onPress={openOrderDetails} activeOpacity={0.88}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={{ color: "#93C5FD", fontSize: 11, fontWeight: "900", letterSpacing: 0.5 }}>
                        {navigationStage === "pickup"
                          ? t("driver.map.trip.nextPickup", "PROCHAINE ÉTAPE: PICKUP")
                          : t("driver.map.trip.nextDropoff", "PROCHAINE ÉTAPE: DROPOFF")}
                      </Text>
                      <Text style={{ color: "#FFFFFF", fontSize: 17, fontWeight: "900", marginTop: 5 }} numberOfLines={1}>
                        {navigationStage === "pickup" ? incomingOrder.pickupAddress : incomingOrder.dropoffAddress}
                      </Text>
                      <Text style={{ color: "#94A3B8", fontSize: 12, marginTop: 5 }}>
                        {t("driver.map.trip.detailsHint", "Toucher pour ouvrir les détails de la course")}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ color: "#FFFFFF", fontSize: 18, fontWeight: "900" }}>{routeEtaText}</Text>
                      <Text style={{ color: "#93C5FD", fontSize: 12, fontWeight: "800", marginTop: 3 }}>{routeDistanceText}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              </View>
            )}

            {!incomingOrder && !errorMsg && (
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: 18,
                  right: 18,
                  bottom: 28,
                  borderRadius: 22,
                  padding: 14,
                  backgroundColor: "rgba(2,6,23,0.90)",
                  borderWidth: 1,
                  borderColor: "rgba(148,163,184,0.18)",
                }}
              >
                <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "900" }}>
                  {t("driver.map.noNavigation.title", "Carte MMD prête")}
                </Text>
                <Text style={{ color: "#94A3B8", fontSize: 12, marginTop: 5 }}>
                  {t("driver.map.noNavigation.body", "Les nouvelles offres peuvent apparaître ici. Pour naviguer, ouvre une course depuis les détails.")}
                </Text>
              </View>
            )}

            {errorMsg && (
              <View
                style={{
                  position: "absolute",
                  left: 18,
                  right: 18,
                  bottom: 26,
                  padding: 12,
                  borderRadius: 14,
                  backgroundColor: "rgba(127,29,29,0.96)",
                  borderWidth: 1,
                  borderColor: "rgba(251,113,133,0.3)",
                }}
              >
                <Text style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "700" }}>
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
