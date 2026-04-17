import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Animated,
  Easing,
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
const SHEET_EXPANDED_TOP = SCREEN_HEIGHT - 500;
const SHEET_COLLAPSED_TOP = SCREEN_HEIGHT - 176;

const IS_DEV = typeof __DEV__ !== "undefined" ? __DEV__ : false;

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
};

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

const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#06111F" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9CA3AF" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#07121F" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#0F172A" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#1E293B" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#020617" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#020617" }] },
  { featureType: "transit", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
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

function formatMoney(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(2)} USD`;
}

function formatMiles(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(2)} mi`;
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
  const [isTogglingOnline, setIsTogglingOnline] = useState(false);

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
  const locationSubscriptionRef = useRef<Location.LocationSubscription | null>(null);

  const sheetTop = useRef(new Animated.Value(SHEET_COLLAPSED_TOP)).current;
  const sheetState = useRef<"collapsed" | "expanded">("collapsed");

  const goPulse = useRef(new Animated.Value(1)).current;
  const goHalo = useRef(new Animated.Value(0.22)).current;
  const incomingTranslateY = useRef(new Animated.Value(-18)).current;
  const incomingOpacity = useRef(new Animated.Value(0)).current;

  const animateSheet = useCallback(
    (target: "collapsed" | "expanded") => {
      const toValue = target === "collapsed" ? SHEET_COLLAPSED_TOP : SHEET_EXPANDED_TOP;
      sheetState.current = target;

      Animated.spring(sheetTop, {
        toValue,
        useNativeDriver: false,
        tension: 45,
        friction: 10,
      }).start();
    },
    [sheetTop]
  );

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
        const threshold = 32;

        if (gestureState.dy < -threshold) {
          animateSheet("expanded");
          return;
        }

        if (gestureState.dy > threshold) {
          animateSheet("collapsed");
          return;
        }

        const currentValue = (sheetTop as any).__getValue?.() ?? SHEET_COLLAPSED_TOP;
        const midpoint = (SHEET_EXPANDED_TOP + SHEET_COLLAPSED_TOP) / 2;
        animateSheet(currentValue < midpoint ? "expanded" : "collapsed");
      },
    })
  ).current;

  const nearbyRestaurantCount = useMemo(() => {
    if (!hasLocation) return 0;
    return restaurants.filter((r) => {
      const dist = distanceMeters(region.latitude, region.longitude, r.latitude, r.longitude);
      return dist < 2500;
    }).length;
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

  const statusTitle = isOnline ? t("driver.map.online") : t("driver.map.offline");

  const statusSubtitle = isOnline
    ? t("driver.map.statusOnlineSubtitle")
    : hasLocation
      ? t("driver.map.statusOfflineSubtitleHasLocation")
      : t("driver.map.statusOfflineSubtitleNoLocation");

  const boostMultiplier =
    currentZone?.activity === "very_busy" ? 1.6 : currentZone?.activity === "busy" ? 1.3 : 1.0;

  const boostLabelGlobal = boostMultiplier > 1 ? `x${boostMultiplier.toFixed(1)}` : null;

  const onlinePillColors = useMemo(
    () =>
      isOnline
        ? {
            borderColor: "#22C55E",
            textColor: "#BBF7D0",
            bgColor: "rgba(4,120,87,0.22)",
          }
        : {
            borderColor: "#FB7185",
            textColor: "#FECDD3",
            bgColor: "rgba(127,29,29,0.22)",
          },
    [isOnline]
  );

  const sheetSummaryCardColor = isOnline ? "#031A12" : "#1A0B0F";

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
        }
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
      stopDriverLocationTracking();
    };
  }, [locateDriver]);

  useEffect(() => {
    if (isOnline || isTogglingOnline) {
      goPulse.stopAnimation();
      goHalo.stopAnimation();
      goPulse.setValue(1);
      goHalo.setValue(0.22);
      return;
    }

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(goPulse, {
            toValue: 1.06,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(goHalo, {
            toValue: 0.38,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ]),
        Animated.parallel([
          Animated.timing(goPulse, {
            toValue: 1,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(goHalo, {
            toValue: 0.18,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ]),
      ])
    );

    pulseLoop.start();

    return () => {
      pulseLoop.stop();
    };
  }, [goHalo, goPulse, isOnline, isTogglingOnline]);

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

  async function getUserIdOrThrow(): Promise<string> {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;

    const uid = data.session?.user?.id;
    if (!uid) {
      throw new Error(t("driver.home.errors.mustBeLoggedIn", "Tu dois être connecté."));
    }

    return uid;
  }

  async function ensureGpsPermission(): Promise<boolean> {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === "granted";
  }

async function validateDriverProfileForOnline(userId: string): Promise<string[]> {
  const missing: string[] = [];

  const { data: driver, error: driverErr } = await supabase
    .from("driver_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (driverErr || !driver) {
    return ["Profil chauffeur introuvable"];
  }

  const { data, error } = await supabase
    .from("driver_documents")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.log("driver_documents error", error);
  }

  const latestByType = new Map<string, any>();

  for (const row of data ?? []) {
    const key = String(row.doc_type);
    if (!latestByType.has(key)) {
      latestByType.set(key, row);
    }
  }

  const documents = Array.from(latestByType.values());

  const docTypeSet = new Set(
    documents.map((d: any) =>
      String(d?.doc_type ?? "")
        .trim()
        .toLowerCase()
    )
  );

  const hasDoc = (docType: string) =>
    docTypeSet.has(docType.toLowerCase());

  console.log("DriverMap FIX docs check", {
    userId,
    docsCount: documents.length,
    docTypes: documents.map((d: any) => d.doc_type),
  });

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

  const isVehicle =
    driver.transport_mode === "car" || driver.transport_mode === "moto";

  if (isVehicle) {
    if (!driver.vehicle_brand) missing.push("Marque véhicule");
    if (!driver.vehicle_model) missing.push("Modèle véhicule");
    if (!driver.vehicle_year) missing.push("Année véhicule");
    if (!driver.vehicle_color) missing.push("Couleur véhicule");
    if (!driver.plate_number) missing.push("Plaque");
    if (!driver.license_number) missing.push("Numéro permis");
    if (!driver.license_expiry) missing.push("Expiration permis");

    if (!hasDoc("license_front")) missing.push("Permis recto");
    if (!hasDoc("license_back")) missing.push("Permis verso");
    if (!hasDoc("insurance")) missing.push("Assurance");
    if (!hasDoc("registration")) missing.push("Registration");
  }

  return missing;
}

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      try {
        const uid = await getUserIdOrThrow();

        const { data: driver, error } = await supabase
          .from("driver_profiles")
          .select("is_online")
          .eq("user_id", uid)
          .maybeSingle();

        if (error) {
          console.log("Erreur chargement statut DB:", error);
        }

        const dbOnline =
          typeof driver?.is_online === "boolean" ? !!driver.is_online : null;

        const localOnline = await getDriverOnlineStatus();
        if (cancelled) return;

        const resolvedOnline = dbOnline !== null ? dbOnline : !!localOnline;

        setIsOnline(resolvedOnline);

        if (resolvedOnline) {
          await setDriverOnlineStatus(true);
          await startDriverLocationTracking({ intervalMs: 2000 });
        } else {
          await setDriverOnlineStatus(false);
          stopDriverLocationTracking();
        }
      } catch (e) {
        console.log("Erreur loadStatus DriverMap:", e);
      }
    }

    void loadStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadDriver() {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error || !data?.user) {
          console.log("🚫 Impossible de récupérer l'utilisateur (driver)", error);
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

      const { data: memberships, error: membershipError } = await supabase
        .from("order_members")
        .select("order_id")
        .eq("user_id", driverId)
        .eq("role", "driver");

      if (membershipError) throw membershipError;

      const orderIds = (memberships ?? []).map((m: any) => m.order_id).filter(Boolean);

      if (orderIds.length === 0) {
        setDriverOrders([]);
        return;
      }

      const { data: ordersData, error: ordersError } = await supabase
        .from("orders")
        .select(`
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
        `)
        .in("id", orderIds)
        .order("created_at", { ascending: false });

      if (ordersError) throw ordersError;

      setDriverOrders((ordersData as DriverOrder[]) ?? []);
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
          if (!cancelled) setRestaurants([]);
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
        if (!cancelled) setRestaurants([]);
      } finally {
        if (!cancelled) setRestaurantsLoading(false);
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
      const d = distanceMeters(region.latitude, region.longitude, zone.center.lat, zone.center.lng);
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

  const handleToggleOnline = useCallback(async () => {
    if (isTogglingOnline) return;

    try {
      setIsTogglingOnline(true);

      const next = !isOnline;
      const userId = await getUserIdOrThrow();

      if (next) {
        const missing = await validateDriverProfileForOnline(userId);

        if (missing.length > 0) {
          Alert.alert(
            "Profil incomplet",
            `Complète ton profil avant de passer en ligne :\n\n${missing
              .map((m) => `• ${m}`)
              .join("\n")}`
          );
          return;
        }

        const ok = await ensureGpsPermission();
        if (!ok) {
          Alert.alert("GPS", "Active le GPS pour passer en ligne.");
          return;
        }
      }

      const { error: updateErr } = await supabase
        .from("driver_profiles")
        .update({ is_online: next })
        .eq("user_id", userId);

      if (updateErr) throw updateErr;

      const { data: refreshed, error: refreshErr } = await supabase
        .from("driver_profiles")
        .select("is_online")
        .eq("user_id", userId)
        .single();

      if (refreshErr) throw refreshErr;

      const confirmedOnline = !!refreshed?.is_online;

      setIsOnline(confirmedOnline);
      await setDriverOnlineStatus(confirmedOnline);

      if (confirmedOnline) {
        await startDriverLocationTracking({ intervalMs: 2000 });
      } else {
        stopDriverLocationTracking();
      }
    } catch (e: any) {
      console.log("Erreur toggle online:", e);
      Alert.alert(
        t("shared.orderChat.alerts.errorTitle", "Erreur"),
        e?.message ?? "Impossible de changer le statut."
      );
    } finally {
      setIsTogglingOnline(false);
    }
  }, [isOnline, isTogglingOnline, t]);

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
    const statusColor =
      order.status === "delivered"
        ? "#22C55E"
        : order.status === "dispatched"
          ? "#FBBF24"
          : order.status === "accepted" || order.status === "prepared" || order.status === "ready"
            ? "#93C5FD"
            : order.status === "canceled"
              ? "#FB7185"
              : "#CBD5E1";

    return (
      <TouchableOpacity
        key={order.id}
        onPress={() => handleOpenOrder(order.id)}
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

        <Text style={{ color: "#7DD3FC", fontSize: 12, fontWeight: "600", marginBottom: 3 }}>
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
          style={{ color: "#94A3B8", fontSize: 11, marginTop: 3, marginBottom: 8 }}
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

      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 10,
          paddingBottom: 10,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: "rgba(2,6,23,0.96)",
        }}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          activeOpacity={0.85}
          style={{
            height: 42,
            minWidth: 42,
            paddingHorizontal: 14,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: "rgba(71,85,105,0.95)",
            backgroundColor: "rgba(15,23,42,0.85)",
            alignItems: "center",
            justifyContent: "center",
            shadowColor: "#000",
            shadowOpacity: 0.16,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
          }}
        >
          <Text style={{ color: "#E5E7EB", fontSize: 13, fontWeight: "700" }}>
            {t("common.back", "← Retour")}
          </Text>
        </TouchableOpacity>

        <View style={{ alignItems: "center" }}>
          <Text style={{ color: "#FFFFFF", fontSize: 17, fontWeight: "800" }}>
            {t("driver.map.headerTitle")}
          </Text>
          <Text style={{ color: "#64748B", fontSize: 10, marginTop: 2 }}>
            Live driver control center
          </Text>
        </View>

        <TouchableOpacity
          onPress={handleToggleOnline}
          activeOpacity={0.9}
          disabled={isTogglingOnline}
          style={{
            minWidth: 96,
            height: 42,
            paddingHorizontal: 12,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: onlinePillColors.borderColor,
            backgroundColor: onlinePillColors.bgColor,
            alignItems: "center",
            justifyContent: "center",
            shadowColor: "#000",
            shadowOpacity: 0.18,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
          }}
        >
          {isTogglingOnline ? (
            <ActivityIndicator size="small" color={onlinePillColors.textColor} />
          ) : (
            <Text
              style={{
                color: onlinePillColors.textColor,
                fontSize: 11,
                fontWeight: "900",
                letterSpacing: 0.6,
              }}
            >
              {statusTitle}
            </Text>
          )}
        </TouchableOpacity>
      </View>

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
                {t("driver.map.locating")}
              </Text>
              <Text style={{ color: "#94A3B8", fontSize: 11, marginTop: 4 }}>
                Positionnement sécurisé en cours...
              </Text>
            </View>
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
                      width: 34,
                      height: 34,
                      borderRadius: 17,
                      backgroundColor: "#22C55E",
                      borderWidth: 3,
                      borderColor: "#FFFFFF",
                      alignItems: "center",
                      justifyContent: "center",
                      shadowColor: "#22C55E",
                      shadowOpacity: 0.45,
                      shadowRadius: 12,
                      shadowOffset: { width: 0, height: 4 },
                    }}
                  >
                    <Text style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "900" }}>D</Text>
                  </View>
                </Marker>
              )}

              {DRIVER_ZONES.map((zone) => {
                const { strokeColor, fillColor, labelColor, haloColor } = getZoneColors(
                  zone.activity
                );

                return (
                  <React.Fragment key={zone.id}>
                    <Polygon
                      coordinates={zone.polygon}
                      strokeColor={strokeColor}
                      strokeWidth={2}
                      fillColor={fillColor}
                    />
                    <Marker coordinate={{ latitude: zone.center.lat, longitude: zone.center.lng }}>
                      <View
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 16,
                          backgroundColor: "rgba(15,23,42,0.96)",
                          borderWidth: 1,
                          borderColor: haloColor,
                          shadowColor: "#000",
                          shadowOpacity: 0.22,
                          shadowRadius: 8,
                          shadowOffset: { width: 0, height: 4 },
                        }}
                      >
                        <Text style={{ color: "#F8FAFC", fontSize: 11, fontWeight: "700" }}>
                          {zone.name}
                        </Text>
                        <Text style={{ color: labelColor, fontSize: 10, marginTop: 2 }}>
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
                  currentZone &&
                  (currentZone.activity === "busy" || currentZone.activity === "very_busy");

                const isClose = dist < 2500;
                const isBoosted = !!inBusyZone && isClose;

                const boostLabel =
                  isBoosted && currentZone
                    ? currentZone.activity === "very_busy"
                      ? "x1.6"
                      : "x1.3"
                    : null;

                return (
                  <Marker
                    key={resto.id}
                    coordinate={{ latitude: resto.latitude, longitude: resto.longitude }}
                  >
                    <View
                      style={{
                        paddingHorizontal: 7,
                        paddingVertical: 5,
                        borderRadius: 999,
                        backgroundColor: "#FFFFFF",
                        borderWidth: 1.5,
                        borderColor: isBoosted ? "#EA580C" : "#F97316",
                        flexDirection: "row",
                        alignItems: "center",
                        shadowColor: "#000",
                        shadowOpacity: isBoosted ? 0.34 : 0.18,
                        shadowRadius: isBoosted ? 10 : 6,
                        shadowOffset: { width: 0, height: 3 },
                      }}
                    >
                      <View
                        style={{
                          width: isBoosted ? 19 : 16,
                          height: isBoosted ? 19 : 16,
                          borderRadius: 10,
                          backgroundColor: isBoosted ? "#EA580C" : "#F97316",
                          alignItems: "center",
                          justifyContent: "center",
                          marginRight: 5,
                        }}
                      >
                        <Text style={{ color: "#FFF", fontSize: 10, fontWeight: "800" }}>
                          {isBoosted ? "🔥" : "R"}
                        </Text>
                      </View>

                      <Text
                        style={{
                          color: "#111827",
                          fontSize: 10,
                          maxWidth: 96,
                          fontWeight: isBoosted ? "700" : "600",
                        }}
                        numberOfLines={1}
                      >
                        {resto.name}
                      </Text>

                      {boostLabel && (
                        <View
                          style={{
                            marginLeft: 5,
                            paddingHorizontal: 5,
                            paddingVertical: 2,
                            borderRadius: 999,
                            backgroundColor: "#FEF3C7",
                          }}
                        >
                          <Text style={{ color: "#B45309", fontSize: 9, fontWeight: "800" }}>
                            {boostLabel}
                          </Text>
                        </View>
                      )}
                    </View>
                  </Marker>
                );
              })}
            </MapView>

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
                top: 16,
                left: 12,
                right: 12,
              }}
            >
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    borderRadius: 999,
                    backgroundColor: "rgba(15,23,42,0.92)",
                    borderWidth: 1,
                    borderColor: "rgba(71,85,105,0.8)",
                  }}
                >
                  <Text style={{ color: "#94A3B8", fontSize: 10, fontWeight: "700" }}>
                    ZONE
                  </Text>
                  <Text style={{ color: "#F8FAFC", fontSize: 12, fontWeight: "900", marginTop: 2 }}>
                    {currentZone?.name ?? "Live area"}
                  </Text>
                </View>

                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    borderRadius: 999,
                    backgroundColor: "rgba(15,23,42,0.92)",
                    borderWidth: 1,
                    borderColor: "rgba(71,85,105,0.8)",
                  }}
                >
                  <Text style={{ color: "#94A3B8", fontSize: 10, fontWeight: "700" }}>
                    OPPORTUNITY
                  </Text>
                  <Text style={{ color: "#F8FAFC", fontSize: 12, fontWeight: "900", marginTop: 2 }}>
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
                    <Text style={{ color: "#FCD34D", fontSize: 10, fontWeight: "700" }}>
                      BOOST
                    </Text>
                    <Text style={{ color: "#FEF3C7", fontSize: 12, fontWeight: "900", marginTop: 2 }}>
                      {boostLabelGlobal}
                    </Text>
                  </View>
                )}

                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    borderRadius: 999,
                    backgroundColor: "rgba(15,23,42,0.92)",
                    borderWidth: 1,
                    borderColor: "rgba(71,85,105,0.8)",
                  }}
                >
                  <Text style={{ color: "#94A3B8", fontSize: 10, fontWeight: "700" }}>
                    NEARBY
                  </Text>
                  <Text style={{ color: "#F8FAFC", fontSize: 12, fontWeight: "900", marginTop: 2 }}>
                    {nearbyRestaurantCount} restos
                  </Text>
                </View>
              </View>
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
                      <Text style={{ color: "#F8FAFC", fontSize: 14, fontWeight: "900" }}>
                        {t("driver.map.incoming.title")}
                      </Text>
                      <Text style={{ color: "#94A3B8", fontSize: 10, marginTop: 2 }}>
                        Nouvelle opportunité premium
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
                      <Text style={{ color: "#FDBA74", fontSize: 11, fontWeight: "900" }}>
                        {incomingTimer}s
                      </Text>
                    </View>
                  </View>

                  <Text style={{ color: "#E5E7EB", fontSize: 13, fontWeight: "700", marginBottom: 3 }}>
                    {incomingOrder.restaurantName}
                  </Text>

                  <Text style={{ color: "#9CA3AF", fontSize: 11 }} numberOfLines={1}>
                    {t("driver.map.incoming.pickup")} {incomingOrder.pickupAddress}
                  </Text>

                  <Text
                    style={{ color: "#9CA3AF", fontSize: 11, marginTop: 2 }}
                    numberOfLines={1}
                  >
                    {t("driver.map.incoming.dropoff")} {incomingOrder.dropoffAddress}
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
                      <Text style={{ color: "#F8FAFC", fontSize: 12, fontWeight: "700" }}>
                        {incomingOrder.distanceMiles.toFixed(1)} mi • {incomingOrder.etaMinutes} min
                      </Text>
                    </View>

                    <View style={{ flexDirection: "row", alignItems: "center" }}>
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
                          <Text style={{ color: "#B45309", fontSize: 10, fontWeight: "800" }}>
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
                        <Text style={{ color: "#BBF7D0", fontSize: 13, fontWeight: "900" }}>
                          {incomingOrder.price.toFixed(2)} $
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TouchableOpacity
                      onPress={() => handleRejectIncomingOrder("reject")}
                      activeOpacity={0.9}
                      style={{
                        flex: 1,
                        paddingVertical: 11,
                        borderRadius: 999,
                        backgroundColor: "#111827",
                        borderWidth: 1,
                        borderColor: "#FDA4AF",
                        alignItems: "center",
                      }}
                    >
                      <Text style={{ color: "#FECDD3", fontSize: 13, fontWeight: "800" }}>
                        {t("driver.map.incoming.decline")}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={handleAcceptIncomingOrder}
                      activeOpacity={0.9}
                      style={{
                        flex: 1,
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
                      <Text style={{ color: "#052E16", fontSize: 13, fontWeight: "900" }}>
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
                <Text style={{ color: "#CBD5E1", fontSize: 10, fontWeight: "700" }}>
                  {t("driver.map.restaurantsLoading")}
                </Text>
              </View>
            )}

            {!isOnline && (
              <View
                pointerEvents="box-none"
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: "43%",
                  alignItems: "center",
                }}
              >
                <Animated.View
                  style={{
                    position: "absolute",
                    width: 162,
                    height: 162,
                    borderRadius: 81,
                    backgroundColor: `rgba(37,99,235,${0.15})`,
                    opacity: goHalo,
                    transform: [{ scale: goPulse }],
                  }}
                />
                <Animated.View
                  style={{
                    transform: [{ scale: goPulse }],
                  }}
                >
                  <TouchableOpacity
                    onPress={handleToggleOnline}
                    activeOpacity={0.92}
                    disabled={isTogglingOnline}
                    style={{
                      width: 134,
                      height: 134,
                      borderRadius: 67,
                      backgroundColor: "#2563EB",
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 6,
                      borderColor: "rgba(191,219,254,0.18)",
                      shadowColor: "#2563EB",
                      shadowOpacity: 0.35,
                      shadowRadius: 18,
                      shadowOffset: { width: 0, height: 10 },
                      elevation: 12,
                    }}
                  >
                    {isTogglingOnline ? (
                      <ActivityIndicator size="large" color="#FFFFFF" />
                    ) : (
                      <>
                        <Text
                          style={{
                            color: "white",
                            fontSize: 30,
                            fontWeight: "900",
                            letterSpacing: 1.1,
                          }}
                        >
                          GO
                        </Text>
                        <Text
                          style={{
                            color: "#DBEAFE",
                            fontSize: 10,
                            marginTop: 4,
                            fontWeight: "700",
                            letterSpacing: 0.5,
                          }}
                        >
                          READY TO DRIVE
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </Animated.View>
              </View>
            )}

            {hasLocation && (
              <View pointerEvents="box-none" style={{ position: "absolute", right: 18, bottom: 214 }}>
                <TouchableOpacity
                  onPress={centerOnDriver}
                  activeOpacity={0.9}
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 26,
                    backgroundColor: "rgba(15,23,42,0.96)",
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 1,
                    borderColor: "rgba(59,130,246,0.85)",
                    shadowColor: "#000",
                    shadowOpacity: 0.30,
                    shadowRadius: 10,
                    shadowOffset: { width: 0, height: 4 },
                  }}
                >
                  <Text style={{ color: "#BFDBFE", fontSize: 21, fontWeight: "900" }}>◎</Text>
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
                    animateSheet(sheetState.current === "collapsed" ? "expanded" : "collapsed")
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
                    <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "800" }}>
                      {t("driver.map.statusTitle")}
                    </Text>
                    <Text style={{ color: "#64748B", fontSize: 10, marginTop: 2 }}>
                      Command center
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
                      borderColor: isOnline ? "rgba(34,197,94,0.55)" : "rgba(251,113,133,0.45)",
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
                    {isOnline ? t("driver.map.statusOnlineTitle") : t("driver.map.statusOfflineTitle")}
                  </Text>

                  <Text style={{ color: "#E2E8F0", fontSize: 11, lineHeight: 17 }}>
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
                    <Text style={{ color: "#94A3B8", fontSize: 10, fontWeight: "700" }}>
                      OPPORTUNITY SCORE
                    </Text>
                    <Text style={{ color: "#F8FAFC", fontSize: 18, fontWeight: "900", marginTop: 4 }}>
                      {zoneOpportunityScore}%
                    </Text>
                    <Text style={{ color: "#60A5FA", fontSize: 11, fontWeight: "700", marginTop: 2 }}>
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
                    <Text style={{ color: "#94A3B8", fontSize: 10, fontWeight: "700" }}>
                      ACTIVE AREA
                    </Text>
                    <Text style={{ color: "#F8FAFC", fontSize: 16, fontWeight: "900", marginTop: 4 }}>
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
                          <Text style={{ color: "#FBBF24", fontSize: 11, fontWeight: "800" }}>
                            {t("driver.map.bonusEstimated", { boost: boostLabelGlobal })}
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

                  {isOnline && (
                    <TouchableOpacity
                      onPress={handleToggleOnline}
                      activeOpacity={0.9}
                      disabled={isTogglingOnline}
                      style={{
                        marginTop: 2,
                        paddingVertical: 12,
                        borderRadius: 999,
                        backgroundColor: "rgba(17,24,39,0.98)",
                        borderWidth: 1,
                        borderColor: "#FB7185",
                        alignItems: "center",
                      }}
                    >
                      {isTogglingOnline ? (
                        <ActivityIndicator size="small" color="#FECACA" />
                      ) : (
                        <Text style={{ color: "#FECACA", fontWeight: "900", fontSize: 13 }}>
                          {t("driver.map.goOffline")}
                        </Text>
                      )}
                    </TouchableOpacity>
                  )}

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
                        <Text style={{ color: "#CBD5E1", fontSize: 11, fontWeight: "700" }}>
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
                      <Text style={{ color: "#E5E7EB", fontSize: 15, fontWeight: "800" }}>
                        {t("driver.map.myOrders.title")}
                      </Text>
                      <Text style={{ color: "#64748B", fontSize: 10, marginTop: 2 }}>
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
                      <Text style={{ color: "#60A5FA", fontSize: 11, fontWeight: "800" }}>
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
                      <Text style={{ color: "#9CA3AF", fontSize: 11, marginLeft: 8 }}>
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
                      <Text style={{ color: "#FECACA", fontSize: 11, fontWeight: "600" }}>
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
                        <Text style={{ color: "#CBD5E1", fontSize: 12, fontWeight: "700" }}>
                          {t("driver.map.myOrders.emptyTitle")}
                        </Text>
                        <Text style={{ color: "#6B7280", fontSize: 10, marginTop: 4 }}>
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