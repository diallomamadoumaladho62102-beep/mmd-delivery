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

/**
 * Zones approximatives (Brooklyn, East New York, Flatbush, Manhattan, etc.)
 * Tu pourras plus tard remplacer les coordonnées + multiplicateurs par ceux de ta base.
 */
const ZONES: ZoneDef[] = [
  // East New York (Brooklyn)
  {
    name: "East New York",
    demand: "busy",
    multiplier: 1.3,
    zoomDelta: 0.035,
    bounds: { minLat: 40.65, maxLat: 40.69, minLon: -73.9, maxLon: -73.84 },
  },
  // Flatbush (Brooklyn)
  {
    name: "Flatbush",
    demand: "busy",
    multiplier: 1.4,
    zoomDelta: 0.035,
    bounds: { minLat: 40.63, maxLat: 40.66, minLon: -73.97, maxLon: -73.94 },
  },
  // Downtown Brooklyn
  {
    name: "Downtown Brooklyn",
    demand: "very_busy",
    multiplier: 1.6,
    zoomDelta: 0.03,
    bounds: { minLat: 40.68, maxLat: 40.7, minLon: -73.99, maxLon: -73.97 },
  },
  // Manhattan (global)
  {
    name: "Manhattan",
    demand: "very_busy",
    multiplier: 1.8,
    zoomDelta: 0.04,
    bounds: { minLat: 40.7, maxLat: 40.86, minLon: -74.02, maxLon: -73.93 },
  },
  // Queens
  {
    name: "Queens",
    demand: "busy",
    multiplier: 1.2,
    zoomDelta: 0.06,
    bounds: { minLat: 40.68, maxLat: 40.78, minLon: -73.92, maxLon: -73.77 },
  },
  // Bronx
  {
    name: "Bronx",
    demand: "busy",
    multiplier: 1.1,
    zoomDelta: 0.06,
    bounds: { minLat: 40.81, maxLat: 40.92, minLon: -73.93, maxLon: -73.82 },
  },
  // Staten Island
  {
    name: "Staten Island",
    demand: "calm",
    multiplier: 1.0,
    zoomDelta: 0.07,
    bounds: { minLat: 40.48, maxLat: 40.64, minLon: -74.26, maxLon: -74.05 },
  },
];

/**
 * Retourne la zone + niveau de demande + multiplicateur selon la position du driver.
 * Si aucune zone ne matche → zone calme générique.
 */
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

  // ✅ ne pas hardcoder dans la UI: on utilise la clé plus bas
  return { name: "Zone actuelle", demand: "calm", multiplier: 1.0, zoomDelta: 0.08 };
}

/**
 * Panneau des livraisons :
 * - translateY = SHEET_MIN_TRANSLATE_Y => complètement en haut (grand)
 * - translateY = SHEET_MAX_TRANSLATE_Y => complètement en bas (on voit juste le header)
 */
const SHEET_MIN_TRANSLATE_Y = 0; // tiré vers le haut
const SHEET_MAX_TRANSLATE_Y = 160; // ✅ ne descend jamais complètement (collapsed)

export function DriverHomeScreen() {
  const navigation = useNavigation<Nav>();
  const navAny = navigation as unknown as AnyNav;
  const { t } = useTranslation();

  const [loading, setLoading] = useState(false);
  const [availableOrders, setAvailableOrders] = useState<DriverOrder[]>([]);
  const [myOrders, setMyOrders] = useState<DriverOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  // ONLINE / OFFLINE
  const [isOnline, setIsOnline] = useState<boolean>(false);

  // Offre en grande carte + chrono
  const [activeOffer, setActiveOffer] = useState<DriverOrder | null>(null);
  const [countdown, setCountdown] = useState<number>(60);

  // Carte chauffeur
  const [region, setRegion] = useState<Region>({
    latitude: 40.650002,
    longitude: -73.949997,
    latitudeDelta: 0.08,
    longitudeDelta: 0.08,
  });
  const [hasLocation, setHasLocation] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(true);

  // Infos sur la zone (nom, niveau, multiplicateur)
  const [zoneStatus, setZoneStatus] = useState<ZoneDemand>("calm");
  const [zoneName, setZoneName] = useState<string>(t("driver.home.zone.current", "Zone actuelle"));
  const [zoneMultiplier, setZoneMultiplier] = useState<number>(1.0);

  // offset pour faire glisser le panneau "Mes livraisons en cours"
  const sheetOffset = useRef(new Animated.Value(SHEET_MAX_TRANSLATE_Y)).current;
  const sheetStartOffset = useRef(0);

  // 🔔 Son: éviter rejouer le même son
  const lastOfferIdRef = useRef<string | null>(null);

  // ✅ refs sound + timers (volume progressif + arrêt auto)
  const soundRef = useRef<Audio.Sound | null>(null);
  const volumeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 🔄 Animation recherche de courses
  const searchingAnim = useRef(new Animated.Value(0)).current;

  // ✅ GPS DB interval (upsert driver_locations)
  const gpsDbIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ✅ stop sound helper (centralisé)
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

  // ✅ helper session + userId
  const getUserIdOrThrow = useCallback(async (): Promise<string> => {
    const { data: sessionData, error: sErr } = await supabase.auth.getSession();
    if (sErr) throw sErr;
    const userId = sessionData.session?.user?.id;
    if (!userId) throw new Error(t("driver.home.errors.mustBeLoggedIn", "Tu dois être connecté."));
    return userId;
  }, [t]);

  // ✅ GPS permissions helper
  const ensureGpsPermission = useCallback(async (): Promise<boolean> => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === "granted";
  }, []);

  // ✅ Start DB tracking (UPSERT into driver_locations every 5s)
  const startDbGpsTracking = useCallback(
    async (driverId: string) => {
      if (!driverId) return;

      // stop if already running
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

          // ✅ FIX IMPORTANT: UPSERT + onConflict driver_id
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

  // ✅ Quand on revient online, on remet le panneau à une position correcte
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

  // ✅ GPS carte (watchPosition) : reste pour la MAP
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

      // 🔍 1) commandes dispo (pending / prepared / ready)
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

      // 🔍 2) Mes commandes acceptées
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

      // ✅ Offres visibles chauffeur = seulement READY
      const readyOnly = allAvailable.filter((o) => o.status === "ready");

      setAvailableOrders(readyOnly);
      setMyOrders(myList);

      // ✅ Offre active = première ready
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

  // Rafraîchir les commandes quand l’écran revient en focus
  useFocusEffect(
    useCallback(() => {
      if (isOnline) {
        void fetchDriverOrders();
      }
    }, [isOnline, fetchDriverOrders])
  );

  // ✅ Realtime : dès qu'une commande change, on refresh direct
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

  // Gestion du chrono pour la grande carte
  useEffect(() => {
    if (!activeOffer) return;
    if (countdown <= 0) {
      setActiveOffer(null);
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [activeOffer, countdown]);

  // 🔄 Animation (conservée, même si la UI n’affiche pas encore "Recherche...")
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(searchingAnim, { toValue: 1, duration: 1200, useNativeDriver: true })
    );
    anim.start();
    return () => anim.stop();
  }, [searchingAnim]);

  // 🔔 Sonnerie répétitive 60s : doux au début, plus fort après 10s
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

        setTimeout(() => {
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

  // ✅ toggle ONLINE/OFFLINE (Supabase + GPS DB)
  const toggleOnline = useCallback(async () => {
    try {
      const next = !isOnline;
      const userId = await getUserIdOrThrow();

      if (next) {
        const ok = await ensureGpsPermission();
        if (!ok) {
          Alert.alert(
            t("driver.home.gps.title", "GPS"),
            t("driver.home.gps.enableToGoOnline", "Active la permission GPS pour passer en ligne.")
          );
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
    } catch (e: any) {
      console.log("toggleOnline error:", e);
      Alert.alert(
        t("shared.orderChat.alerts.errorTitle", "Erreur"),
        e?.message ?? t("driver.home.errors.toggleOnline", "Impossible de changer le statut.")
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

  // ✅ Fallback propre pour compat vieux champs (si tu avais anciennement pickup_lon, pickup_long, etc.)
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

  // ✅ sécurité: si l'écran se démonte, couper interval DB
  useEffect(() => {
    return () => {
      void stopDbGpsTracking();
    };
  }, [stopDbGpsTracking]);

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

        {/* Header */}
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

          {/* Zone info */}
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

        {/* ✅ BARRE BOUTONS (HORS LIGNE SEULEMENT) */}
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

        {/* Bas de l’écran (EN LIGNE SEULEMENT) */}
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
                  backgroundColor: "rgba(15,23,42,0.96)",
                  borderTopLeftRadius: 16,
                  borderTopRightRadius: 16,
                  paddingHorizontal: 16,
                  paddingTop: 10,
                  paddingBottom: 16,
                }}
                {...panResponder.panHandlers}
              >
                <View style={{ alignItems: "center", marginBottom: 8 }}>
                  <View style={{ width: 40, height: 4, borderRadius: 999, backgroundColor: "#4B5563" }} />
                </View>

                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <Text style={{ color: "#E5E7EB", fontSize: 15, fontWeight: "600" }}>
                    {t("driver.home.myOrders.title", "Mes livraisons en cours")}
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
                      {t("driver.home.myOrders.loading", "Chargement de tes livraisons…")}
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
                        {t("driver.home.myOrders.emptyTitle", "Tu n’as pas encore de livraison en cours.")}
                      </Text>
                      <Text style={{ color: "#6B7280", fontSize: 11, marginTop: 2, textAlign: "center" }}>
                        {t("driver.home.myOrders.emptySubtitle", "Dès qu’une course est acceptée, elle apparaîtra ici.")}
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
                            {t("driver.home.labels.driverEarnings", "Gain chauffeur:")}{" "}
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
                          {t("driver.home.myOrders.viewDetails", "Voir les détails →")}
                        </Text>
                      </TouchableOpacity>
                    ))
                  )}
                </ScrollView>
              </Animated.View>
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}