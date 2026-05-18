import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  ScrollView,
  Alert,
  Image,
  Animated,
  Easing,
} from "react-native";
import { Audio } from "expo-av";
import Mapbox from "@rnmapbox/maps";
import { supabase } from "../lib/supabase";
import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";

const FALLBACK_RESTAURANT_ID = "306ef52d-aa3c-4475-a7f3-abe0f9f6817c";
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "";
const DEFAULT_RESTAURANT_COORDINATE: [number, number] = [-73.949997, 40.650002];
const MAP_STYLE_URL = "mapbox://styles/mapbox/dark-v11";
const MAX_VISIBLE_MAP_ORDERS = 12;
const MAX_NEARBY_DRIVERS = 8;

if (MAPBOX_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_TOKEN);
} else if (__DEV__) {
  console.log("[RestaurantHomeScreen] EXPO_PUBLIC_MAPBOX_TOKEN manquant");
}

type DashboardStats = {
  ordersToday: number;
  revenueToday: number;
  pendingOrders: number;
  currency: string;
};

type RestaurantProfileLite = {
  restaurant_name?: string | null;
  is_accepting_orders?: boolean | null;
  location_lat?: number | string | null;
  location_lng?: number | string | null;
};

type RestaurantMapOrder = {
  id: string;
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
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0
  );
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

function distanceMilesBetweenCoordinates(
  from: [number, number],
  to: [number, number]
): number {
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

  if (!isFiniteCoordinate(rawLat, rawLng)) return null;

  const lat = Number(rawLat);
  const lng = Number(rawLng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return [lng, lat];
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

function StatCard({
  icon,
  title,
  value,
  bg,
  border,
  iconBg,
  titleColor = "#C7D2FE",
}: {
  icon: string;
  title: string;
  value: string;
  bg: string;
  border: string;
  iconBg: string;
  titleColor?: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        minHeight: 170,
        borderRadius: 22,
        padding: 16,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
        justifyContent: "space-between",
      }}
    >
      <View
        style={{
          width: 58,
          height: 58,
          borderRadius: 18,
          backgroundColor: iconBg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 26 }}>{icon}</Text>
      </View>

      <View>
        <Text
          style={{
            color: titleColor,
            fontWeight: "800",
            fontSize: 15,
            lineHeight: 20,
          }}
        >
          {title}
        </Text>

        <Text
          style={{
            color: "white",
            fontWeight: "900",
            fontSize: 34,
            marginTop: 14,
          }}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

function ActionTile({
  icon,
  label,
  bg,
  border,
  iconBg,
  onPress,
}: {
  icon: string;
  label: string;
  bg: string;
  border: string;
  iconBg: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 150,
        borderRadius: 22,
        padding: 16,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
        justifyContent: "space-between",
      }}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 22,
          backgroundColor: iconBg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 34 }}>{icon}</Text>
      </View>

      <Text
        style={{
          color: "white",
          fontWeight: "800",
          fontSize: 18,
          lineHeight: 24,
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function ToolRow({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={onPress}
      style={{
        backgroundColor: "#08112A",
        borderWidth: 1,
        borderColor: "#0F172A",
        borderRadius: 22,
        paddingHorizontal: 18,
        paddingVertical: 20,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 14,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 16,
            backgroundColor: "#0D1838",
            alignItems: "center",
            justifyContent: "center",
            marginRight: 14,
          }}
        >
          <Text style={{ fontSize: 26 }}>{icon}</Text>
        </View>

        <Text
          style={{
            color: "white",
            fontSize: 18,
            fontWeight: "800",
          }}
        >
          {label}
        </Text>
      </View>

      <Text style={{ color: "#6B7280", fontSize: 28, fontWeight: "700" }}>›</Text>
    </TouchableOpacity>
  );
}

function TopPillButton({
  label,
  onPress,
  borderColor,
  backgroundColor,
  textColor,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  borderColor: string;
  backgroundColor: string;
  textColor: string;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.88}
      disabled={disabled}
      onPress={onPress}
      style={{
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 999,
        backgroundColor,
        borderWidth: 1,
        borderColor,
        opacity: disabled ? 0.65 : 1,
      }}
    >
      <Text style={{ color: textColor, fontWeight: "900" }}>{label}</Text>
    </TouchableOpacity>
  );
}

function BrandMark() {
  const hasMobileLogo = true;

  if (hasMobileLogo) {
    return (
      <View
        style={{
          width: 82,
          height: 82,
          borderRadius: 22,
          backgroundColor: "#08112A",
          borderWidth: 1,
          borderColor: "#1F2937",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          shadowColor: "#000",
          shadowOpacity: 0.18,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 6 },
          elevation: 4,
        }}
      >
        <Image
          source={
            // Après avoir copié le logo ici:
            // apps/mobile/assets/brand/mmd-logo.png
            require("../../assets/brand/mmd-logo.png")
          }
          style={{ width: 54, height: 54 }}
          resizeMode="contain"
        />
      </View>
    );
  }

  return (
    <View
      style={{
        width: 82,
        height: 82,
        borderRadius: 22,
        backgroundColor: "#08112A",
        borderWidth: 1,
        borderColor: "#1F2937",
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#000",
        shadowOpacity: 0.18,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 6 },
        elevation: 4,
      }}
    >
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: 16,
          backgroundColor: "#0D1838",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text
          style={{
            color: "#60A5FA",
            fontSize: 20,
            fontWeight: "900",
            letterSpacing: 0.6,
          }}
        >
          MMD
        </Text>
      </View>
    </View>
  );
}


function statusColor(status: string | null | undefined) {
  const normalized = String(status ?? "").trim().toLowerCase();

  if (normalized === "pending") return "#F97316";
  if (normalized === "accepted" || normalized === "prepared") return "#3B82F6";
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

function StatusLegendItem({
  label,
  color,
}: {
  label: string;
  color: string;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        marginRight: 12,
        marginBottom: 8,
      }}
    >
      <View
        style={{
          width: 9,
          height: 9,
          borderRadius: 5,
          backgroundColor: color,
          marginRight: 7,
        }}
      />
      <Text style={{ color: "#CBD5E1", fontSize: 11, fontWeight: "800" }}>
        {label}
      </Text>
    </View>
  );
}

function RestaurantMapPin({ label }: { label: string }) {
  return (
    <View
      style={{
        width: 76,
        height: 76,
        borderRadius: 38,
        backgroundColor: "rgba(59,130,246,0.18)",
        borderWidth: 1,
        borderColor: "rgba(147,197,253,0.34)",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: 46,
          height: 46,
          borderRadius: 23,
          backgroundColor: "rgba(2,6,23,0.96)",
          borderWidth: 2,
          borderColor: "#60A5FA",
          alignItems: "center",
          justifyContent: "center",
          shadowColor: "#60A5FA",
          shadowOpacity: 0.55,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 0 },
          elevation: 8,
        }}
      >
        <Text style={{ color: "#FFFFFF", fontSize: 20, fontWeight: "900" }}>
          {label}
        </Text>
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
        minWidth: 48,
        minHeight: 46,
        borderRadius: 23,
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: "rgba(2,6,23,0.96)",
        borderWidth: 2,
        borderColor: color,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: color,
        shadowOpacity: 0.5,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 0 },
        elevation: 8,
      }}
    >
      <Text style={{ color, fontSize: 13, fontWeight: "900" }}>#{index + 1}</Text>
      <Text
        numberOfLines={1}
        style={{ color: "#CBD5E1", fontSize: 8, fontWeight: "900", marginTop: 1 }}
      >
        {label}
      </Text>
    </View>
  );
}

function DriverMapPin({ index }: { index: number }) {
  return (
    <View
      style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: "rgba(15,23,42,0.95)",
        borderWidth: 2,
        borderColor: "#38BDF8",
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#38BDF8",
        shadowOpacity: 0.55,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 0 },
        elevation: 8,
      }}
    >
      <Text style={{ color: "#BAE6FD", fontSize: 12, fontWeight: "900" }}>D{index + 1}</Text>
    </View>
  );
}

export function RestaurantHomeScreen({ navigation }: any) {
  const { t } = useTranslation();
  const soundRef = useRef<Audio.Sound | null>(null);
  const isFocused = useIsFocused();

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [restaurantUserId, setRestaurantUserId] = useState<string | null>(null);
  const [restaurantName, setRestaurantName] = useState("Fouta Halal");
  const [statsLoading, setStatsLoading] = useState(false);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [restaurantOnline, setRestaurantOnline] = useState(true);
  const [mapOrders, setMapOrders] = useState<RestaurantMapOrder[]>([]);
  const [nearbyDrivers, setNearbyDrivers] = useState<NearbyDriver[]>([]);
  const [restaurantCoordinate, setRestaurantCoordinate] =
    useState<[number, number]>(DEFAULT_RESTAURANT_COORDINATE);

  const pinPulseAnim = useRef(new Animated.Value(0)).current;
  const bottomSheetAnim = useRef(new Animated.Value(0)).current;

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
          .select("id,status,total,subtotal,tax,currency,created_at")
          .eq("restaurant_id", activeRestaurantId)
          .gte("created_at", fromISO),
        supabase
          .from("orders")
          .select("id,status,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,created_at,total")
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

      const pendingRows = (pendingRes.data ?? []) as RestaurantMapOrder[];
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
        .select("restaurant_name,is_accepting_orders,location_lat,location_lng")
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
      }

      if (profileCoordinate) {
        setRestaurantCoordinate(profileCoordinate);
      } else {
        setRestaurantCoordinate(DEFAULT_RESTAURANT_COORDINATE);
      }

      if (typeof profile?.is_accepting_orders === "boolean") {
        setRestaurantOnline(profile.is_accepting_orders);
      } else {
        setRestaurantOnline(true);
      }
    } catch (e) {
      console.log("Restaurant profile load exception:", e);
    }
  }, []);

  const updateRestaurantAvailability = useCallback(
    async (nextValue: boolean) => {
      if (!restaurantUserId) return;

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
    [restaurantUserId, t]
  );

  const handleToggleAvailability = useCallback(() => {
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
  }, [restaurantOnline, t, updateRestaurantAvailability]);

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
    void loadDashboardStats();
    void loadNearbyDrivers();
  }, [checkingAuth, loadDashboardStats, loadNearbyDrivers]);

  useEffect(() => {
    if (checkingAuth || !isFocused) return;
    void loadDashboardStats();
    void loadNearbyDrivers();
  }, [checkingAuth, isFocused, loadDashboardStats, loadNearbyDrivers]);

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
    if (!isFocused) return;
    bottomSheetAnim.setValue(0);
    Animated.timing(bottomSheetAnim, {
      toValue: 1,
      duration: 460,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [bottomSheetAnim, isFocused]);

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

          if (restaurantOnline && isFocused && row?.status === "pending") {
            await playRing();
          }

          void loadDashboardStats();
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
        async () => {
          void loadDashboardStats();
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
    loadDashboardStats,
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

  const availabilityTheme = restaurantOnline
    ? {
        label: t("restaurant.dashboard.online", "Online"),
        dot: "#22C55E",
        text: "#BBF7D0",
        border: "rgba(34,197,94,0.32)",
        bg: "rgba(34,197,94,0.12)",
      }
    : {
        label: t("restaurant.dashboard.offline", "Offline"),
        dot: "#F87171",
        text: "#FECACA",
        border: "rgba(248,113,113,0.32)",
        bg: "rgba(239,68,68,0.10)",
      };

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
    return visibleMapOrders
      .map((order, index) => {
        const coords = orderCoordinate(order);
        if (!coords) return null;
        const [lng, lat] = coords;
        return { id: `heat-${order.id}`, lng, lat, weight: Math.max(1, MAX_VISIBLE_MAP_ORDERS - index) };
      })
      .filter(Boolean) as MapPoint[];
  }, [visibleMapOrders]);

  const surgePoints = useMemo(() => {
    const pendingCount = visibleMapOrders.filter((order) => String(order.status ?? "").toLowerCase() === "pending").length;
    if (pendingCount < 3) return [];
    return [{ id: "restaurant-surge-main", lng: restaurantCoordinate[0], lat: restaurantCoordinate[1], weight: pendingCount }];
  }, [restaurantCoordinate, visibleMapOrders]);

  const routeLines = useMemo(() => {
    return visibleMapOrders
      .map((order) => {
        const coords = orderCoordinate(order);
        if (!coords) return null;
        return { id: `route-${order.id}`, coordinates: [restaurantCoordinate, coords] as [number, number][] };
      })
      .filter(Boolean) as Array<{ id: string; coordinates: [number, number][] }>;
  }, [restaurantCoordinate, visibleMapOrders]);

  const aiDispatchInsight = useMemo(() => {
    if (!restaurantOnline) return t("restaurant.dashboard.aiOffline", "AI dispatch paused while restaurant is offline.");
    if (stats.pendingOrders >= 5) return t("restaurant.dashboard.aiHighDemand", "AI dispatch: high demand detected. Prioritize ready orders and keep prep times tight.");
    if (visibleDrivers.length === 0 && stats.pendingOrders > 0) return t("restaurant.dashboard.aiNeedDrivers", "AI dispatch: orders are active, but no nearby drivers were detected yet.");
    if (visibleDrivers.length >= 3) return t("restaurant.dashboard.aiDriversReady", "AI dispatch: nearby drivers available. Keep ready orders moving.");
    return t("restaurant.dashboard.aiStable", "AI dispatch: demand is stable. Map is monitoring new requests live.");
  }, [restaurantOnline, stats.pendingOrders, t, visibleDrivers.length]);

  const bottomSheetTranslateY = bottomSheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [26, 0],
  });

  const pinPulseScale = pinPulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.12],
  });

  const pinPulseOpacity = pinPulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.72],
  });

  const liveMapSubtitle = restaurantOnline
    ? t(
        "restaurant.dashboard.mapLiveSubtitle",
        "Live order map · {{count}} active request(s)",
        { count: stats.pendingOrders }
      )
    : t("restaurant.dashboard.mapOfflineSubtitle", "Restaurant offline · map preview");

  if (checkingAuth) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: "#020617",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <StatusBar barStyle="light-content" />
        <ActivityIndicator />
        <Text style={{ color: "white", marginTop: 10 }}>
          {t("common.loading", "Chargement…")}
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />

      <View style={{ flex: 1, backgroundColor: "#020617" }}>
        <Mapbox.MapView
          pointerEvents="none"
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
          styleURL={MAP_STYLE_URL}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
          scaleBarEnabled={false}
          surfaceView={false}
        >
          <Mapbox.Camera
            zoomLevel={12}
            centerCoordinate={restaurantCoordinate}
            animationMode="flyTo"
            animationDuration={700}
          />

          {heatmapPoints.length > 0 && (
            <Mapbox.ShapeSource id="restaurant-heatmap-source" shape={makePointFeatureCollection(heatmapPoints)}>
              <Mapbox.CircleLayer
                id="restaurant-heatmap-layer"
                style={{
                  circleRadius: ["interpolate", ["linear"], ["get", "weight"], 1, 18, 12, 54] as any,
                  circleColor: "#F97316",
                  circleOpacity: 0.16,
                  circleBlur: 0.85,
                }}
              />
            </Mapbox.ShapeSource>
          )}

          {surgePoints.length > 0 && (
            <Mapbox.ShapeSource id="restaurant-surge-source" shape={makePointFeatureCollection(surgePoints)}>
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
            <Mapbox.ShapeSource id="restaurant-route-lines-source" shape={makeLineFeatureCollection(routeLines)}>
              <Mapbox.LineLayer
                id="restaurant-route-lines-layer"
                style={{
                  lineColor: "#60A5FA",
                  lineOpacity: 0.38,
                  lineWidth: 2.4,
                  lineDasharray: [2, 2],
                }}
              />
            </Mapbox.ShapeSource>
          )}

          <Mapbox.PointAnnotation
            id="restaurant-home-pin"
            coordinate={restaurantCoordinate}
          >
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
                <Animated.View style={{ opacity: pinPulseOpacity, transform: [{ scale: pinPulseScale }] }}>
                  <OrderMapPin status={order.status} index={index} />
                </Animated.View>
              </Mapbox.PointAnnotation>
            );
          })}

          {visibleDrivers.map((driver, index) => (
            <Mapbox.PointAnnotation
              key={`restaurant-driver-${driver.driver_id}`}
              id={`restaurant-driver-${driver.driver_id}`}
              coordinate={[driver.lng, driver.lat]}
            >
              <DriverMapPin index={index} />
            </Mapbox.PointAnnotation>
          ))}
        </Mapbox.MapView>

        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: "rgba(2,6,23,0.42)",
          }}
        />

        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: "58%",
            backgroundColor: "rgba(2,6,23,0.72)",
          }}
        />

        <Animated.ScrollView
          style={{
            opacity: bottomSheetAnim,
            transform: [{ translateY: bottomSheetTranslateY }],
          }}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 18,
            paddingBottom: 34,
          }}
          showsVerticalScrollIndicator={false}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              activeOpacity={0.85}
              style={{
                width: 46,
                height: 46,
                borderRadius: 23,
                backgroundColor: "rgba(2,6,23,0.88)",
                borderWidth: 1,
                borderColor: "rgba(148,163,184,0.20)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: "#93C5FD", fontWeight: "900", fontSize: 20 }}>
                {t("common.backArrow", "←")}
              </Text>
            </TouchableOpacity>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <TopPillButton
                label={
                  availabilityLoading
                    ? t("common.loading", "Loading…")
                    : restaurantOnline
                      ? t("restaurant.dashboard.goOfflineBtn", "Go offline")
                      : t("restaurant.dashboard.goOnlineBtn", "Go online")
                }
                onPress={handleToggleAvailability}
                borderColor={availabilityTheme.border}
                backgroundColor={availabilityTheme.bg}
                textColor={availabilityTheme.text}
                disabled={availabilityLoading}
              />

              <TopPillButton
                label={
                  statsLoading
                    ? t("common.loading", "Loading…")
                    : t("common.refresh", "Refresh")
                }
                onPress={() => { void loadDashboardStats(); void loadNearbyDrivers(); }}
                borderColor="rgba(148,163,184,0.20)"
                backgroundColor="rgba(2,6,23,0.86)"
                textColor="#E5E7EB"
                disabled={statsLoading}
              />
            </View>
          </View>

          <View
            style={{
              borderRadius: 30,
              overflow: "hidden",
              borderWidth: 1,
              borderColor: "rgba(96,165,250,0.24)",
              backgroundColor: "rgba(2,6,23,0.58)",
              marginBottom: 16,
              shadowColor: "#000",
              shadowOpacity: 0.26,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 10 },
              elevation: 12,
            }}
          >
            <View
              style={{
                padding: 16,
                minHeight: 168,
                justifyContent: "space-between",
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                }}
              >
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text
                    style={{
                      color: "#FFFFFF",
                      fontSize: 28,
                      fontWeight: "900",
                      lineHeight: 34,
                    }}
                  >
                    {t("restaurant.dashboard.title", "Restaurant Dashboard")}
                  </Text>

                  <Text
                    style={{
                      color: "#CBD5E1",
                      fontSize: 13,
                      fontWeight: "700",
                      marginTop: 8,
                    }}
                  >
                    {liveMapSubtitle}
                  </Text>
                </View>

                <BrandMark />
              </View>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginTop: 18,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                  <View
                    style={{
                      width: 58,
                      height: 58,
                      borderRadius: 29,
                      backgroundColor: "rgba(15,23,42,0.92)",
                      borderWidth: 1,
                      borderColor: "rgba(148,163,184,0.22)",
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 12,
                    }}
                  >
                    <Text
                      style={{
                        color: "#E5E7EB",
                        fontSize: 22,
                        fontWeight: "900",
                      }}
                    >
                      {avatarLetter}
                    </Text>
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text
                      numberOfLines={1}
                      style={{
                        color: "#FFFFFF",
                        fontSize: 17,
                        fontWeight: "900",
                      }}
                    >
                      {restaurantName}
                    </Text>

                    <Text
                      numberOfLines={1}
                      style={{
                        color: "#94A3B8",
                        fontSize: 12,
                        fontWeight: "700",
                        marginTop: 4,
                      }}
                    >
                      {t("restaurant.dashboard.mapControlCenter", "Restaurant live control center")}
                    </Text>
                  </View>
                </View>

                <View
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: availabilityTheme.border,
                    backgroundColor: availabilityTheme.bg,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: availabilityTheme.dot,
                    }}
                  />
                  <Text
                    style={{
                      color: availabilityTheme.text,
                      fontWeight: "900",
                      fontSize: 12,
                    }}
                  >
                    {availabilityTheme.label}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          <View
            style={{
              borderRadius: 28,
              backgroundColor: "rgba(2,6,23,0.92)",
              borderWidth: 1,
              borderColor: "rgba(148,163,184,0.16)",
              padding: 14,
              marginBottom: 18,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <Text style={{ color: "#E5E7EB", fontSize: 15, fontWeight: "900" }}>
                {t("restaurant.dashboard.liveMap", "Live restaurant map")}
              </Text>

              <TouchableOpacity
                activeOpacity={0.86}
                onPress={() => navigation.navigate("RestaurantOrders")}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: 999,
                  backgroundColor: "rgba(59,130,246,0.14)",
                  borderWidth: 1,
                  borderColor: "rgba(96,165,250,0.28)",
                }}
              >
                <Text style={{ color: "#BFDBFE", fontSize: 12, fontWeight: "900" }}>
                  {t("restaurant.dashboard.openOrders", "Open orders")}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <View
                style={{
                  flex: 1,
                  borderRadius: 20,
                  padding: 12,
                  backgroundColor: "rgba(249,115,22,0.12)",
                  borderWidth: 1,
                  borderColor: "rgba(249,115,22,0.22)",
                }}
              >
                <Text style={{ color: "#FDBA74", fontSize: 12, fontWeight: "900" }}>
                  {t("restaurant.dashboard.pendingOrders", "Pending orders")}
                </Text>
                <Text style={{ color: "#FFFFFF", fontSize: 28, fontWeight: "900", marginTop: 8 }}>
                  {statsLoading ? "..." : stats.pendingOrders}
                </Text>
              </View>

              <View
                style={{
                  flex: 1,
                  borderRadius: 20,
                  padding: 12,
                  backgroundColor: "rgba(34,197,94,0.11)",
                  borderWidth: 1,
                  borderColor: "rgba(34,197,94,0.22)",
                }}
              >
                <Text style={{ color: "#86EFAC", fontSize: 12, fontWeight: "900" }}>
                  {t("restaurant.dashboard.visibleMapOrders", "Visible on map")}
                </Text>
                <Text style={{ color: "#FFFFFF", fontSize: 28, fontWeight: "900", marginTop: 8 }}>
                  {visibleMapOrders.length}
                </Text>
              </View>
            </View>

            <View
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTopWidth: 1,
                borderTopColor: "rgba(148,163,184,0.12)",
              }}
            >
              <Text
                style={{
                  color: "#94A3B8",
                  fontSize: 11,
                  fontWeight: "900",
                  marginBottom: 8,
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                }}
              >
                {t("restaurant.dashboard.mapLegend", "Map legend")}
              </Text>

              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                <StatusLegendItem label={t("restaurant.dashboard.status.pending", "Pending")} color="#F97316" />
                <StatusLegendItem label={t("restaurant.dashboard.status.accepted", "Accepted")} color="#3B82F6" />
                <StatusLegendItem label={t("restaurant.dashboard.status.ready", "Ready")} color="#22C55E" />
                <StatusLegendItem label={t("restaurant.dashboard.status.driver", "Driver nearby")} color="#38BDF8" />
                <StatusLegendItem label={t("restaurant.dashboard.status.surge", "Surge zone")} color="#EF4444" />
              </View>
            </View>

            <View
              style={{
                marginTop: 12,
                borderRadius: 20,
                padding: 12,
                backgroundColor: "rgba(139,92,246,0.12)",
                borderWidth: 1,
                borderColor: "rgba(167,139,250,0.24)",
              }}
            >
              <Text style={{ color: "#C4B5FD", fontSize: 12, fontWeight: "900", marginBottom: 6 }}>
                {t("restaurant.dashboard.aiDispatch", "AI Dispatch")}
              </Text>
              <Text style={{ color: "#E5E7EB", fontSize: 12, fontWeight: "700", lineHeight: 17 }}>
                {aiDispatchInsight}
              </Text>
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <View
                style={{
                  flex: 1,
                  borderRadius: 18,
                  padding: 12,
                  backgroundColor: "rgba(56,189,248,0.10)",
                  borderWidth: 1,
                  borderColor: "rgba(56,189,248,0.22)",
                }}
              >
                <Text style={{ color: "#BAE6FD", fontSize: 11, fontWeight: "900" }}>
                  {t("restaurant.dashboard.driversNearby", "Drivers nearby")}
                </Text>
                <Text style={{ color: "#FFFFFF", fontSize: 24, fontWeight: "900", marginTop: 6 }}>
                  {visibleDrivers.length}
                </Text>
              </View>

              <View
                style={{
                  flex: 1,
                  borderRadius: 18,
                  padding: 12,
                  backgroundColor: surgePoints.length > 0 ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.10)",
                  borderWidth: 1,
                  borderColor: surgePoints.length > 0 ? "rgba(248,113,113,0.24)" : "rgba(34,197,94,0.20)",
                }}
              >
                <Text style={{ color: surgePoints.length > 0 ? "#FCA5A5" : "#86EFAC", fontSize: 11, fontWeight: "900" }}>
                  {t("restaurant.dashboard.surgeZone", "Surge zone")}
                </Text>
                <Text style={{ color: "#FFFFFF", fontSize: 24, fontWeight: "900", marginTop: 6 }}>
                  {surgePoints.length > 0 ? t("common.yes", "Yes") : t("common.no", "No")}
                </Text>
              </View>
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 12, marginBottom: 18 }}>
            <StatCard
              icon="📋"
              title={t("restaurant.dashboard.ordersToday", "Orders today")}
              value={statsLoading ? "..." : String(stats.ordersToday)}
              bg="rgba(37,99,235,0.16)"
              border="rgba(96,165,250,0.28)"
              iconBg="rgba(37,99,235,0.20)"
            />

            <StatCard
              icon="💲"
              title={t("restaurant.dashboard.revenueToday", "Revenue today")}
              value={statsLoading ? "..." : formatMoney(stats.revenueToday, stats.currency)}
              bg="rgba(16,185,129,0.14)"
              border="rgba(52,211,153,0.24)"
              iconBg="rgba(16,185,129,0.18)"
              titleColor="#A7F3D0"
            />

            <StatCard
              icon="⏱️"
              title={t("restaurant.dashboard.pendingOrders", "Pending orders")}
              value={statsLoading ? "..." : String(stats.pendingOrders)}
              bg="rgba(217,119,6,0.16)"
              border="rgba(251,191,36,0.26)"
              iconBg="rgba(217,119,6,0.18)"
              titleColor="#FCD34D"
            />
          </View>

          <View style={{ flexDirection: "row", gap: 12, marginBottom: 12 }}>
            <ActionTile
              icon="📋"
              label={t("restaurant.dashboard.viewOrders", "View orders")}
              bg="#08112A"
              border="#0F172A"
              iconBg="#0D1838"
              onPress={() => navigation.navigate("RestaurantOrders")}
            />
            <ActionTile
              icon="💲"
              label={t("restaurant.dashboard.earnings", "Earnings")}
              bg="#0A122A"
              border="#131A31"
              iconBg="#1A223D"
              onPress={() => navigation.navigate("RestaurantEarnings")}
            />
          </View>

          <View style={{ flexDirection: "row", gap: 12, marginBottom: 26 }}>
            <ActionTile
              icon="🧾"
              label={t("restaurant.dashboard.taxCenter", "Tax Center")}
              bg="rgba(37,99,235,0.16)"
              border="rgba(96,165,250,0.28)"
              iconBg="rgba(147,197,253,0.18)"
              onPress={() => navigation.navigate("RestaurantTax")}
            />
            <ActionTile
              icon="👤"
              label={t("restaurant.dashboard.account", "Account")}
              bg="rgba(16,185,129,0.12)"
              border="rgba(52,211,153,0.24)"
              iconBg="rgba(110,231,183,0.16)"
              onPress={() => navigation.navigate("RestaurantLanguage")}
            />
          </View>

          <Text
            style={{
              color: "#94A3B8",
              fontSize: 18,
              fontWeight: "900",
              marginBottom: 14,
            }}
          >
            {t("restaurant.dashboard.tools", "Restaurant tools")}
          </Text>

          <ToolRow
            icon="🌐"
            label={t("common.language", "Language")}
            onPress={() => navigation.navigate("RestaurantLanguage")}
          />

          <ToolRow
            icon="🔒"
            label={t("common.security", "Security")}
            onPress={() => navigation.navigate("RestaurantSecurity")}
          />

          <ToolRow
            icon="🔐"
            label={t(
              "restaurant.dashboard.securityPassword",
              "Security / Change password"
            )}
            onPress={() => navigation.navigate("RestaurantSecurity")}
          />
        </Animated.ScrollView>
      </View>
    </SafeAreaView>
  );
}
