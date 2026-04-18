import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Animated,
  PanResponder,
  Image,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";

import MapView, { Marker, Region } from "react-native-maps";
import * as Location from "expo-location";
import { Audio } from "expo-av";
import { useTranslation } from "react-i18next";

/**
 * ✅ IMPORTANT:
 * Ton erreur TS venait du fait que "DriverHome" n'est pas déclaré dans RootStackParamList.
 * Pour ne rien casser, on évite de contraindre le type avec un nom de route qui peut varier.
 */
type Nav = NativeStackNavigationProp<RootStackParamList>;
type AnyNav = NativeStackNavigationProp<any>;

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

  // ✅ coords stockées dans orders (DB = lat + lng)
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
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

function getZoneInfoFromLocation(
  lat: number,
  lon: number
): { name: string; demand: ZoneDemand; multiplier: number; zoomDelta: number } {
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

  return { name: "Zone actuelle", demand: "calm", multiplier: 1.0, zoomDelta: 0.08 };
}

const SHEET_MIN_TRANSLATE_Y = 0;
const SHEET_MAX_TRANSLATE_Y = 160;

export function DriverHomeScreen() {
  const navigation = useNavigation<Nav>();
  const navAny = navigation as unknown as AnyNav;
  const { t } = useTranslation();

  const [loading, setLoading] = useState(false);
  const [availableOrders, setAvailableOrders] = useState<DriverOrder[]>([]);
  const [myOrders, setMyOrders] = useState<DriverOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const [isOnline, setIsOnline] = useState<boolean>(false);

  const [activeOffer, setActiveOffer] = useState<DriverOrder | null>(null);
  const [countdown, setCountdown] = useState<number>(60);

  const [region, setRegion] = useState<Region>({
    latitude: 40.650002,
    longitude: -73.949997,
    latitudeDelta: 0.08,
    longitudeDelta: 0.08,
  });
  const [hasLocation, setHasLocation] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(true);

  const [zoneStatus, setZoneStatus] = useState<ZoneDemand>("calm");
  const [zoneName, setZoneName] = useState<string>(t("driver.home.zone.current", "Zone actuelle"));
  const [zoneMultiplier, setZoneMultiplier] = useState<number>(1.0);

  const [searchMessageIndex, setSearchMessageIndex] = useState(0);

  const searchMessages = useMemo(
    () => [
      t("driver.home.searching.msg1", "Searching for the best trips near you"),
      t("driver.home.searching.msg2", "Analyzing the most profitable routes"),
      t("driver.home.searching.msg3", "Prioritizing nearby and urgent requests"),
      t("driver.home.searching.msg4", "Live sync with your current zone"),
    ],
    [t]
  );

  const sheetOffset = useRef(new Animated.Value(SHEET_MAX_TRANSLATE_Y)).current;
  const sheetStartOffset = useRef(0);

  const lastOfferIdRef = useRef<string | null>(null);

  const soundRef = useRef<Audio.Sound | null>(null);
  const volumeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchingAnim = useRef(new Animated.Value(0)).current;

  const gpsDbIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopSound = useCallback(async () => {
    try {
      if (volumeIntervalRef.current) {
        clearInterval(volumeIntervalRef.current);
        volumeIntervalRef.current = null;
      }

      if (stopTimeoutRef.current) {
        clearTimeout(stopTimeoutRef.current);
        stopTimeoutRef.current = null;
      }

      if (soundRef.current) {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
    } catch {}
  }, []);

  const getUserIdOrThrow = useCallback(async (): Promise<string> => {
    const { data: sessionData, error: sErr } = await supabase.auth.getSession();
    if (sErr) throw sErr;
    const userId = sessionData.session?.user?.id;
    if (!userId) throw new Error(t("driver.home.errors.mustBeLoggedIn", "Tu dois être connecté."));
    return userId;
  }, [t]);

  const ensureGpsPermission = useCallback(async (): Promise<boolean> => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === "granted";
  }, []);

  const startDbGpsTracking = useCallback(
    async (driverId: string) => {
      if (!driverId) return;
      if (gpsDbIntervalRef.current) return;

      const ok = await ensureGpsPermission();
      if (!ok) {
        Alert.alert(
          t("driver.home.gps.title", "GPS"),
          t("driver.home.gps.permissionDenied", "Permission GPS refusée.")
        );
        return;
      }

      const pushLocationOnce = async () => {
        try {
          const loc = await Location.getCurrentPositionAsync({});
          const lat = loc.coords.latitude;
          const lng = loc.coords.longitude;

          const { error: upErr } = await supabase.from("driver_locations").upsert(
            {
              driver_id: driverId,
              lat,
              lng,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "driver_id" }
          );

          if (upErr) {
            console.log("❌ driver_locations upsert error:", upErr);
          }
        } catch (e) {
          console.log("❌ GPS push error:", e);
        }
      };

      await pushLocationOnce();

      gpsDbIntervalRef.current = setInterval(() => {
        void pushLocationOnce();
      }, 5000);
    },
    [ensureGpsPermission, t]
  );

  const stopDbGpsTracking = useCallback(async () => {
    if (gpsDbIntervalRef.current) {
      clearInterval(gpsDbIntervalRef.current);
      gpsDbIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isOnline) {
      Animated.spring(sheetOffset, {
        toValue: SHEET_MAX_TRANSLATE_Y,
        useNativeDriver: true,
      }).start();
    }
  }, [isOnline, sheetOffset]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 4,
      onPanResponderGrant: () => {
        // @ts-ignore
        sheetStartOffset.current = sheetOffset.__getValue
          ? // @ts-ignore
            sheetOffset.__getValue()
          : 0;
      },
      onPanResponderMove: (_, gestureState) => {
        const dy = gestureState.dy;
        const raw = sheetStartOffset.current + dy;
        const clamped = Math.max(SHEET_MIN_TRANSLATE_Y, Math.min(SHEET_MAX_TRANSLATE_Y, raw));
        sheetOffset.setValue(clamped);
      },
      onPanResponderRelease: (_, gestureState) => {
        const goingUp = gestureState.dy < 0;
        const final = goingUp ? SHEET_MIN_TRANSLATE_Y : SHEET_MAX_TRANSLATE_Y;

        Animated.spring(sheetOffset, { toValue: final, useNativeDriver: true }).start();
      },
    })
  ).current;

  const zoneLabelAndColor = useMemo(() => {
    if (zoneStatus === "very_busy") {
      return { label: t("driver.home.zone.very_busy", "Très chargé"), color: "#EF4444" };
    }
    if (zoneStatus === "busy") {
      return { label: t("driver.home.zone.busy", "Occupé"), color: "#F97316" };
    }
    return { label: t("driver.home.zone.calm", "Calme"), color: "#22C55E" };
  }, [zoneStatus, t]);

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;

    (async () => {
      try {
        const ok = await ensureGpsPermission();
        if (!ok) {
          setGpsLoading(false);
          return;
        }

        const current = await Location.getCurrentPositionAsync({});

        const zoneInfo = getZoneInfoFromLocation(current.coords.latitude, current.coords.longitude);
        setZoneName(zoneInfo.name || t("driver.home.zone.current", "Zone actuelle"));
        setZoneStatus(zoneInfo.demand);
        setZoneMultiplier(zoneInfo.multiplier);

        setRegion({
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
          latitudeDelta: zoneInfo.zoomDelta,
          longitudeDelta: zoneInfo.zoomDelta,
        });
        setHasLocation(true);
        setGpsLoading(false);

        sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 4000,
            distanceInterval: 10,
          },
          (pos) => {
            const info = getZoneInfoFromLocation(pos.coords.latitude, pos.coords.longitude);
            setZoneName(info.name || t("driver.home.zone.current", "Zone actuelle"));
            setZoneStatus(info.demand);
            setZoneMultiplier(info.multiplier);

            setRegion({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              latitudeDelta: info.zoomDelta,
              longitudeDelta: info.zoomDelta,
            });
            setHasLocation(true);
          }
        );
      } catch (e) {
        console.log("Erreur GPS driver:", e);
        setGpsLoading(false);
      }
    })();

    return () => {
      if (sub) sub.remove();
    };
  }, [ensureGpsPermission, t]);

  const fetchDriverOrders = useCallback(async () => {
    try {
      if (!isOnline) {
        setAvailableOrders([]);
        setMyOrders([]);
        setActiveOffer(null);
        return;
      }

      setLoading(true);
      setError(null);

      const driverId = await getUserIdOrThrow();

      const { data: available, error: availableError } = await supabase
        .from("orders")
        .select(
          `id, kind, status, created_at,
           restaurant_name, pickup_address, dropoff_address,
           distance_miles, delivery_fee, driver_delivery_payout, total,
           pickup_lat, pickup_lng, dropoff_lat, dropoff_lng`
        )
        .in("status", ["pending", "prepared", "ready"])
        .is("driver_id", null)
        .order("created_at", { ascending: false });

      if (availableError) throw availableError;

      const { data: mine, error: mineError } = await supabase
        .from("orders")
        .select(
          `id, kind, status, created_at,
           restaurant_name, pickup_address, dropoff_address,
           distance_miles, delivery_fee, driver_delivery_payout, total,
           pickup_lat, pickup_lng, dropoff_lat, dropoff_lng`
        )
        .eq("driver_id", driverId)
        .not("status", "in", '("delivered","canceled")')
        .order("created_at", { ascending: false });

      if (mineError) throw mineError;

      const allAvailable = (available ?? []) as DriverOrder[];
      const myList = (mine ?? []) as DriverOrder[];
      const readyOnly = allAvailable.filter((o) => o.status === "ready");

      setAvailableOrders(readyOnly);
      setMyOrders(myList);

      if (!activeOffer && readyOnly.length > 0) {
        setActiveOffer(readyOnly[0]);
        setCountdown(60);
      } else if (readyOnly.length === 0) {
        setActiveOffer(null);
      }
    } catch (e: any) {
      console.log("Erreur chargement commandes driver:", e);
      setError(t("driver.home.errors.loadOrders", "Impossible de charger les commandes."));
    } finally {
      setLoading(false);
    }
  }, [isOnline, activeOffer, getUserIdOrThrow, t]);

  useFocusEffect(
    useCallback(() => {
      if (isOnline) {
        void fetchDriverOrders();
      }
    }, [isOnline, fetchDriverOrders])
  );

  useEffect(() => {
    if (!isOnline) return;

    const channel = supabase
      .channel("driver-orders-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        void fetchDriverOrders();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isOnline, fetchDriverOrders]);

  const formatStatus = useCallback(
    (status: OrderStatus) => {
      switch (status) {
        case "pending":
          return t("driver.home.status.pending", "En attente (restaurant)");
        case "accepted":
          return t("driver.home.status.accepted", "Acceptée");
        case "prepared":
          return t("driver.home.status.prepared", "En préparation");
        case "ready":
          return t("driver.home.status.ready", "Prête (en attente driver)");
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
    [t]
  );

  const formatKind = useCallback(
    (kind: OrderKind, restaurantName: string | null) => {
      if (kind === "food") {
        return restaurantName
          ? t("driver.home.kind.foodWithName", "Commande restaurant · {{name}}", { name: restaurantName })
          : t("driver.home.kind.food", "Commande restaurant");
      }
      if (kind === "pickup_dropoff") return t("driver.home.kind.pickup_dropoff", "Course pickup / dropoff");
      return String(kind);
    },
    [t]
  );

  const formatDate = useCallback((iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }, []);

  const handleOpenOrder = useCallback(
    (orderId: string) => {
      navAny.navigate("DriverOrderDetails", { orderId });
    },
    [navAny]
  );

  const handleAccept = useCallback(
    async (orderId: string) => {
      try {
        setAcceptingId(orderId);

        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) throw new Error(t("driver.home.errors.mustBeLoggedIn", "Tu dois être connecté."));

        const { error: rpcError } = await supabase.rpc("driver_accept_ready_order", {
          p_order_id: orderId,
        });
        if (rpcError) throw rpcError;

        await supabase.rpc("join_order", { p_order_id: orderId, p_role: "driver" });

        Alert.alert(
          t("driver.home.accept.title", "Course acceptée"),
          t("driver.home.accept.body", "Tu es maintenant assigné sur cette livraison.")
        );

        await stopSound();

        setActiveOffer(null);
        await fetchDriverOrders();

        navAny.navigate("DriverOrderDetails", { orderId });
      } catch (e: any) {
        console.log("Erreur acceptation course:", e);
        Alert.alert(
          t("shared.orderChat.alerts.errorTitle", "Erreur"),
          e?.message ?? t("driver.home.errors.accept", "Impossible d'accepter la course.")
        );
      } finally {
        setAcceptingId(null);
      }
    },
    [fetchDriverOrders, navAny, stopSound, t]
  );

  const handleDeclineActiveOffer = useCallback(async () => {
    await stopSound();
    setActiveOffer(null);
  }, [stopSound]);

  useEffect(() => {
    if (!activeOffer) return;
    if (countdown <= 0) {
      setActiveOffer(null);
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [activeOffer, countdown]);

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(searchingAnim, { toValue: 1, duration: 1200, useNativeDriver: true })
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

    if (lastOfferIdRef.current === activeOffer.id) return;
    lastOfferIdRef.current = activeOffer.id;

    (async () => {
      try {
        await stopSound();

        const { sound } = await Audio.Sound.createAsync(
          require("../../assets/sounds/new-order.wav"),
          { shouldPlay: true, isLooping: true, volume: 0.2 }
        );

        soundRef.current = sound;
        await sound.playAsync();

        const rampTimeout = setTimeout(() => {
          let volume = 0.2;

          volumeIntervalRef.current = setInterval(async () => {
            if (!soundRef.current) return;

            volume += 0.1;
            if (volume >= 1) {
              volume = 1;
              if (volumeIntervalRef.current) {
                clearInterval(volumeIntervalRef.current);
                volumeIntervalRef.current = null;
              }
            }

            try {
              await soundRef.current.setVolumeAsync(volume);
            } catch {}
          }, 1000);
        }, 10000);

        stopTimeoutRef.current = setTimeout(() => {
          clearTimeout(rampTimeout);
          void stopSound();
        }, 60000);
      } catch (e) {
        console.log("🔕 Sound error:", e);
      }
    })();

    return () => {
      void stopSound();
    };
  }, [activeOffer?.id, stopSound]);

  const toggleOnline = useCallback(async () => {
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

      if (docsErr) {
        throw docsErr;
      }

      const latestByType = new Map<string, any>();

      for (const row of docs ?? []) {
        const key = String(row?.doc_type ?? row?.type ?? "").trim().toLowerCase();

        if (key && !latestByType.has(key)) {
          latestByType.set(key, row);
        }
      }

      const documents = Array.from(latestByType.values());

      const docTypeSet = new Set(
        documents.map((d: any) =>
          String(d?.doc_type ?? d?.type ?? "").trim().toLowerCase()
        )
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
        if (!driver.license_expiration && !driver.license_expiry) {
          missing.push("Expiration permis");
        }

        if (!hasDoc("license_front")) missing.push("Permis recto");
        if (!hasDoc("license_back")) missing.push("Permis verso");
        if (!hasDoc("insurance")) missing.push("Assurance");
        if (!hasDoc("registration")) missing.push("Registration");
      }

      if (missing.length > 0) {
        Alert.alert(
          "Profil incomplet",
          "Complète ton profil avant de passer en ligne :\n\n" +
            missing.map((m) => "• " + m).join("\n")
        );
        return;
      }

      if (next) {
        const ok = await ensureGpsPermission();
        if (!ok) {
          Alert.alert("GPS", "Active le GPS pour passer en ligne.");
          return;
        }

        const { error: upErr } = await supabase
          .from("driver_profiles")
          .update({ is_online: true })
          .eq("user_id", userId);

        if (upErr) throw upErr;

        setIsOnline(true);

        await startDbGpsTracking(userId);
        await fetchDriverOrders();
        return;
      }

      const { error: downErr } = await supabase
        .from("driver_profiles")
        .update({ is_online: false })
        .eq("user_id", userId);

      if (downErr) throw downErr;

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
      Alert.alert(
        t("shared.orderChat.alerts.errorTitle", "Erreur"),
        e?.message ?? "Impossible de changer le statut."
      );
    }
  }, [
    ensureGpsPermission,
    fetchDriverOrders,
    getUserIdOrThrow,
    isOnline,
    startDbGpsTracking,
    stopDbGpsTracking,
    stopSound,
    t,
  ]);

  const onlineLabel = isOnline ? t("driver.home.online", "EN LIGNE") : t("driver.home.offline", "HORS LIGNE");
  const onlineColorBg = isOnline ? "#22C55E" : "#EF4444";
  const onlineColorText = "#F9FAFB";

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

  const go = useCallback(
    (routeName: string) => {
      navAny.navigate(routeName);
    },
    [navAny]
  );

  useEffect(() => {
    return () => {
      void stopDbGpsTracking();
      void stopSound();
    };
  }, [stopDbGpsTracking, stopSound]);

  const searchShimmerTranslate = searchingAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-320, 320],
  });

  const searchPulseScale = searchingAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 1.025, 1],
  });

  const searchOpacity = searchingAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.84, 1, 0.84],
  });

  const radarOuterScale = searchingAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.9, 1.25],
  });

  const radarOuterOpacity = searchingAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.02],
  });

  const radarInnerScale = searchingAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 1.12, 1],
  });

  const glowOpacity = searchingAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.18, 0.34, 0.18],
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />

      <View style={{ flex: 1 }}>
        <MapView style={{ flex: 1 }} region={region} onRegionChangeComplete={(r) => setRegion(r)}>
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
                <Text style={{ color: "white", fontSize: 11, fontWeight: "700" }}>D</Text>
              </View>
            </Marker>
          )}

          {activeOffer && hasOfferPickup && (
            <Marker
              coordinate={{
                latitude: activeOffer.pickup_lat as number,
                longitude: offerPickupLng as number,
              }}
              title={t("driver.home.map.pickupTitle", "Pickup")}
              description={activeOffer.pickup_address ?? undefined}
            />
          )}

          {activeOffer && hasOfferDropoff && (
            <Marker
              coordinate={{
                latitude: activeOffer.dropoff_lat as number,
                longitude: offerDropoffLng as number,
              }}
              title={t("driver.home.map.dropoffTitle", "Dropoff")}
              description={activeOffer.dropoff_address ?? undefined}
            />
          )}
        </MapView>

        {gpsLoading && (
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(15,23,42,0.4)",
            }}
          >
            <ActivityIndicator color="#ffffff" />
            <Text style={{ color: "#E5E7EB", marginTop: 8 }}>
              {t("driver.home.gps.locating", "Localisation du chauffeur…")}
            </Text>
          </View>
        )}

        <View style={{ position: "absolute", top: 16, left: 16, right: 16 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View>
              <Text style={{ fontSize: 20, fontWeight: "800", color: "white" }}>
                {t("driver.home.header.title", "Tableau de bord chauffeur")}
              </Text>
              <Text style={{ color: "#9CA3AF", fontSize: 12, marginTop: 2 }}>
                {t("driver.home.header.subtitle", "La carte reste toujours active.")}
              </Text>
            </View>

            <TouchableOpacity
              onPress={toggleOnline}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 14,
                borderRadius: 999,
                backgroundColor: onlineColorBg,
              }}
            >
              <Text style={{ color: onlineColorText, fontSize: 12, fontWeight: "700" }}>
                {onlineLabel}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ marginTop: 10, flexDirection: "row", justifyContent: "flex-start" }}>
            <View
              style={{
                borderRadius: 999,
                paddingVertical: 4,
                paddingHorizontal: 12,
                backgroundColor: "#020617",
                borderWidth: 1,
                borderColor: "#1E293B",
              }}
            >
              <Text style={{ color: "#9CA3AF", fontSize: 11 }}>
                {t("driver.home.zone.title", "Activité dans ta zone")}
              </Text>
              <Text style={{ color: "#E5E7EB", fontSize: 12, fontWeight: "600" }}>
                {zoneName}
              </Text>
              <Text style={{ color: zoneLabelAndColor.color, fontSize: 13, fontWeight: "700" }}>
                {zoneLabelAndColor.label}
                {zoneMultiplier > 1 ? ` · x${zoneMultiplier.toFixed(1)}` : ""}
              </Text>
            </View>
          </View>
        </View>

        {!isOnline && (
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              paddingBottom: 18,
              paddingTop: 10,
              paddingHorizontal: 18,
              backgroundColor: "rgba(2,6,23,0.92)",
              borderTopWidth: 1,
              borderTopColor: "#1F2937",
            }}
          >
            <View
              style={{
                height: 64,
                borderRadius: 18,
                backgroundColor: "rgba(15,23,42,0.95)",
                borderWidth: 1,
                borderColor: "#1F2937",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 10,
              }}
            >
              <TouchableOpacity
                style={{ flex: 1, alignItems: "center", paddingVertical: 10 }}
                onPress={() => go("DriverHome")}
              >
                <Text style={{ color: "#E5E7EB", fontSize: 12, fontWeight: "900" }}>
                  {t("driver.home.tabs.home", "Accueil")}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{ flex: 1, alignItems: "center", paddingVertical: 10 }}
                onPress={() => go("DriverRevenue")}
              >
                <Text style={{ color: "#E5E7EB", fontSize: 12, fontWeight: "900" }}>
                  {t("driver.home.tabs.revenue", "Revenus")}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{ flex: 1, alignItems: "center", paddingVertical: 10 }}
                onPress={() => go("DriverInbox")}
              >
                <Text style={{ color: "#E5E7EB", fontSize: 12, fontWeight: "900" }}>
                  {t("driver.home.tabs.inbox", "Boîte")}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{ flex: 1, alignItems: "center", paddingVertical: 10 }}
                onPress={() => go("DriverMenu")}
              >
                <Text style={{ color: "#E5E7EB", fontSize: 12, fontWeight: "900" }}>
                  {t("driver.home.tabs.menu", "Menu")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {isOnline && (
          <View style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
            {activeOffer ? (
              <View style={{ paddingHorizontal: 16, paddingBottom: 20 }}>
                <View style={{ alignItems: "center", marginBottom: 8 }}>
                  <Text style={{ color: "#E5E7EB", fontSize: 18, fontWeight: "800", marginBottom: 4 }}>
                    {t("driver.home.offer.title", "Nouvelle course disponible")}
                  </Text>
                  <Text style={{ color: "#F97316", fontSize: 28, fontWeight: "800" }}>
                    {countdown}s
                  </Text>
                </View>

                <View
                  style={{
                    backgroundColor: "#020617",
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: "#1F2937",
                    padding: 14,
                  }}
                >
                  <Text style={{ color: "#93C5FD", fontSize: 13, marginBottom: 6 }}>
                    {formatKind(activeOffer.kind, activeOffer.restaurant_name)}
                  </Text>

                  <View style={{ marginBottom: 8 }}>
                    <Text style={{ color: "#9CA3AF", fontSize: 12, marginBottom: 2 }}>
                      {t("driver.home.offer.pickup", "Pickup :")}
                    </Text>
                    <Text style={{ color: "#E5E7EB", fontSize: 14, fontWeight: "500" }}>
                      {activeOffer.pickup_address ?? "—"}
                    </Text>
                  </View>

                  <View style={{ marginBottom: 8 }}>
                    <Text style={{ color: "#9CA3AF", fontSize: 12, marginBottom: 2 }}>
                      {t("driver.home.offer.dropoff", "Dropoff :")}
                    </Text>
                    <Text style={{ color: "#E5E7EB", fontSize: 14, fontWeight: "500" }}>
                      {activeOffer.dropoff_address ?? "—"}
                    </Text>
                  </View>

                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4, marginBottom: 4 }}>
                    <View>
                      <Text style={{ color: "#9CA3AF", fontSize: 11, marginBottom: 2 }}>
                        {t("driver.home.offer.distance", "Distance estimée")}
                      </Text>
                      <Text style={{ color: "#E5E7EB", fontSize: 15, fontWeight: "700" }}>
                        {activeOffer.distance_miles != null ? `${activeOffer.distance_miles.toFixed(2)} mi` : "—"}
                      </Text>
                    </View>

                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ color: "#9CA3AF", fontSize: 11, marginBottom: 2 }}>
                        {t("driver.home.offer.earnings", "Gain estimé")}
                      </Text>
                      <Text style={{ color: "#4ADE80", fontSize: 15, fontWeight: "800" }}>
                        {(() => {
                          const gain =
                            activeOffer.driver_delivery_payout ??
                            activeOffer.delivery_fee ??
                            activeOffer.total;
                          return gain != null ? `${gain.toFixed(2)} USD` : "—";
                        })()}
                      </Text>
                    </View>
                  </View>

                  <Text style={{ color: "#6B7280", fontSize: 11, marginTop: 2 }}>
                    {t("driver.home.offer.createdAt", "Créée :")} {formatDate(activeOffer.created_at)}
                  </Text>
                </View>

                <View style={{ flexDirection: "row", marginTop: 12, gap: 10 }}>
                  <TouchableOpacity
                    onPress={handleDeclineActiveOffer}
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: "#4B5563",
                      alignItems: "center",
                      backgroundColor: "#020617",
                    }}
                  >
                    <Text style={{ color: "#E5E7EB", fontSize: 14, fontWeight: "600" }}>
                      {t("driver.home.offer.decline", "Refuser")}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => handleAccept(activeOffer.id)}
                    disabled={acceptingId === activeOffer.id}
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      borderRadius: 999,
                      backgroundColor: "#22C55E",
                      alignItems: "center",
                      opacity: acceptingId === activeOffer.id ? 0.6 : 1,
                    }}
                  >
                    <Text style={{ color: "#022C22", fontSize: 14, fontWeight: "700" }}>
                      {acceptingId === activeOffer.id
                        ? t("driver.home.offer.accepting", "Acceptation...")
                        : t("driver.home.offer.accept", "Accepter")}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <Animated.View
                style={{
                  transform: [{ translateY: sheetOffset }],
                  paddingHorizontal: 12,
                  paddingBottom: 0,
                }}
                {...panResponder.panHandlers}
              >
                {/* PREMIUM SEARCH BAR */}
                <Animated.View
                  style={{
                    transform: [{ scale: searchPulseScale }],
                    opacity: searchOpacity,
                    marginBottom: 0,
                    borderRadius: 24,
                    overflow: "hidden",
                    backgroundColor: "rgba(2,6,23,0.97)",
                    borderWidth: 1,
                    borderColor: "rgba(96,165,250,0.22)",
                    shadowColor: "#60A5FA",
                    shadowOpacity: 0.24,
                    shadowRadius: 18,
                    shadowOffset: { width: 0, height: 8 },
                    elevation: 10,
                  }}
                >
                  {/* glow background */}
                  <Animated.View
                    pointerEvents="none"
                    style={{
                      position: "absolute",
                      top: -20,
                      left: -20,
                      right: -20,
                      bottom: -20,
                      opacity: glowOpacity,
                      backgroundColor: "#0F172A",
                    }}
                  />

                  <View
                    style={{
                      paddingHorizontal: 16,
                      paddingTop: 14,
                      paddingBottom: 14,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                      }}
                    >
                      {/* MMD LOGO PREMIUM */}
                      <Animated.View
                        style={{
                          transform: [{ scale: radarInnerScale }],
                          width: 54,
                          height: 54,
                          borderRadius: 16,
                          marginRight: 12,
                          justifyContent: "center",
                          alignItems: "center",
                          backgroundColor: "#0B0F1A",
                          shadowColor: "#FF6A00",
                          shadowOpacity: 0.85,
                          shadowRadius: 18,
                          shadowOffset: { width: 0, height: 6 },
                          elevation: 16,
                        }}
                      >
                        <View
                          style={{
                            width: "100%",
                            height: "100%",
                            borderRadius: 16,
                            overflow: "hidden",
                            borderWidth: 1.5,
                            borderColor: "rgba(255,140,0,0.5)",
                          }}
                        >
                          <Image
                            source={require("../../assets/brand/mmd-logo.png")}
                            style={{ width: "100%", height: "100%" }}
                            resizeMode="contain"
                          />
                        </View>
                      </Animated.View>

                      {/* text */}
                      <View style={{ flex: 1 }}>
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            marginBottom: 3,
                          }}
                        >
                          <Text
                            style={{
                              color: "#F8FAFC",
                              fontSize: 15,
                              fontWeight: "900",
                              letterSpacing: 0.2,
                            }}
                          >
                            {t("driver.home.searching.title", "Premium detection mode")}
                          </Text>

                          <View
                            style={{
                              marginLeft: 8,
                              paddingHorizontal: 9,
                              paddingVertical: 3,
                              borderRadius: 999,
                              backgroundColor: "rgba(34,197,94,0.14)",
                              borderWidth: 1,
                              borderColor: "rgba(34,197,94,0.28)",
                            }}
                          >
                            <Text
                              style={{
                                color: "#4ADE80",
                                fontSize: 10,
                                fontWeight: "900",
                                letterSpacing: 0.4,
                              }}
                            >
                              LIVE
                            </Text>
                          </View>
                        </View>

                        <Text
                          style={{
                            color: "#93C5FD",
                            fontSize: 12.5,
                            fontWeight: "600",
                          }}
                        >
                          {searchMessages[searchMessageIndex]}
                        </Text>
                      </View>
                    </View>

                    {/* status chips */}
                    <View
                      style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        marginTop: 12,
                        gap: 8,
                      }}
                    >
                      <View
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 999,
                          backgroundColor: "rgba(59,130,246,0.12)",
                          borderWidth: 1,
                          borderColor: "rgba(59,130,246,0.24)",
                        }}
                      >
                        <Text style={{ color: "#BFDBFE", fontSize: 11, fontWeight: "700" }}>
                          {t("driver.home.searching.chip1", "Nearby trips")}
                        </Text>
                      </View>

                      <View
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 999,
                          backgroundColor: "rgba(34,197,94,0.12)",
                          borderWidth: 1,
                          borderColor: "rgba(34,197,94,0.24)",
                        }}
                      >
                        <Text style={{ color: "#86EFAC", fontSize: 11, fontWeight: "700" }}>
                          {t("driver.home.searching.chip2", "Optimized earnings")}
                        </Text>
                      </View>

                      <View
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 999,
                          backgroundColor: "rgba(249,115,22,0.12)",
                          borderWidth: 1,
                          borderColor: "rgba(249,115,22,0.24)",
                        }}
                      >
                        <Text style={{ color: "#FDBA74", fontSize: 11, fontWeight: "700" }}>
                          {t("driver.home.searching.chip3", "Priority zone")}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* shimmer */}
                  <Animated.View
                    pointerEvents="none"
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      width: 140,
                      transform: [{ translateX: searchShimmerTranslate }, { skewX: "-18deg" }],
                      backgroundColor: "rgba(255,255,255,0.08)",
                    }}
                  />
                </Animated.View>

                {/* MY ACTIVE DELIVERIES PANEL */}
                <View
                  style={{
                    backgroundColor: "rgba(15,23,42,0.96)",
                    borderTopLeftRadius: 16,
                    borderTopRightRadius: 16,
                    paddingHorizontal: 16,
                    paddingTop: 4,
                    paddingBottom: 16,
                  }}
                >
                  <View style={{ alignItems: "center", marginBottom: 8 }}>
                    <View style={{ width: 40, height: 4, borderRadius: 999, backgroundColor: "#4B5563" }} />
                  </View>

                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 6,
                    }}
                  >
                    <Text style={{ color: "#E5E7EB", fontSize: 15, fontWeight: "600" }}>
                      {t("driver.home.myOrders.title", "My active deliveries")}
                    </Text>

                    <TouchableOpacity onPress={() => void fetchDriverOrders()}>
                      <Text style={{ color: "#3B82F6", fontSize: 12, fontWeight: "500" }}>
                        {t("shared.common.refresh", "Refresh")}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {loading && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <ActivityIndicator color="#ffffff" />
                      <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
                        {t("driver.home.myOrders.loading", "Loading your deliveries…")}
                      </Text>
                    </View>
                  )}

                  {error && (
                    <Text style={{ color: "#F97373", fontSize: 12, marginBottom: 6 }}>
                      {error}
                    </Text>
                  )}

                  <ScrollView style={{ maxHeight: 260 }} contentContainerStyle={{ paddingBottom: 8 }}>
                    {myOrders.length === 0 && !loading ? (
                      <View style={{ paddingVertical: 12, alignItems: "center" }}>
                        <Text style={{ color: "#9CA3AF", fontSize: 13, textAlign: "center" }}>
                          {t("driver.home.myOrders.emptyTitle", "You don’t have any active deliveries yet.")}
                        </Text>
                        <Text style={{ color: "#6B7280", fontSize: 11, marginTop: 2, textAlign: "center" }}>
                          {t(
                            "driver.home.myOrders.emptySubtitle",
                            "As soon as a trip is accepted, it will appear here."
                          )}
                        </Text>
                      </View>
                    ) : (
                      myOrders.map((order) => (
                        <TouchableOpacity
                          key={order.id}
                          onPress={() => handleOpenOrder(order.id)}
                          style={{
                            backgroundColor: "#020617",
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: "#1F2937",
                            padding: 10,
                            marginBottom: 8,
                          }}
                        >
                          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
                            <Text style={{ color: "#E5E7EB", fontSize: 13, fontWeight: "600" }}>
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

                          <Text style={{ color: "#9CA3AF", fontSize: 11, marginBottom: 2 }}>
                            {t("driver.home.labels.pickup", "Pickup:")}{" "}
                            <Text style={{ color: "#E5E7EB", fontWeight: "500" }} numberOfLines={1}>
                              {order.pickup_address ?? "—"}
                            </Text>
                          </Text>
                          <Text style={{ color: "#9CA3AF", fontSize: 11, marginBottom: 4 }}>
                            {t("driver.home.labels.dropoff", "Dropoff:")}{" "}
                            <Text style={{ color: "#E5E7EB", fontWeight: "500" }} numberOfLines={1}>
                              {order.dropoff_address ?? "—"}
                            </Text>
                          </Text>

                          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
                            <Text style={{ color: "#9CA3AF", fontSize: 11 }}>
                              {t("driver.home.labels.distance", "Distance:")}{" "}
                              <Text style={{ color: "#E5E7EB", fontWeight: "600" }}>
                                {order.distance_miles != null ? `${order.distance_miles.toFixed(2)} mi` : "—"}
                              </Text>
                            </Text>

                            <Text style={{ color: "#9CA3AF", fontSize: 11 }}>
                              {t("driver.home.labels.driverEarnings", "Driver earnings:")}{" "}
                              <Text style={{ color: "#E5E7EB", fontWeight: "700" }}>
                                {order.driver_delivery_payout != null
                                  ? `${order.driver_delivery_payout.toFixed(2)} USD`
                                  : order.delivery_fee != null
                                  ? `${order.delivery_fee.toFixed(2)} USD`
                                  : order.total != null
                                  ? `${order.total.toFixed(2)} USD`
                                  : "—"}
                              </Text>
                            </Text>
                          </View>

                          <Text
                            style={{
                              marginTop: 4,
                              color: "#3B82F6",
                              fontSize: 11,
                              fontWeight: "600",
                              textAlign: "right",
                            }}
                          >
                            {t("driver.home.myOrders.viewDetails", "View details →")}
                          </Text>
                        </TouchableOpacity>
                      ))
                    )}
                  </ScrollView>
                </View>
              </Animated.View>
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}