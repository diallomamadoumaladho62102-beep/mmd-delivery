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
} from "react-native";
import { Audio } from "expo-av";
import { supabase } from "../lib/supabase";
import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";

const FALLBACK_RESTAURANT_ID = "306ef52d-aa3c-4475-a7f3-abe0f9f6817c";

type DashboardStats = {
  ordersToday: number;
  revenueToday: number;
  pendingOrders: number;
  currency: string;
};

type RestaurantProfileLite = {
  restaurant_name?: string | null;
  is_accepting_orders?: boolean | null;
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

function buildOrderAmount(row: any) {
  const total = Number(row?.total ?? 0);
  if (Number.isFinite(total) && total > 0) return total;

  const subtotal = Number(row?.subtotal ?? 0);
  const tax = Number(row?.tax ?? 0);
  const derived = subtotal + tax;
  return Number.isFinite(derived) ? derived : 0;
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
          .select("id,status")
          .eq("restaurant_id", activeRestaurantId)
          .in("status", ["pending", "accepted", "prepared", "ready"]),
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

      const pendingOrders = (pendingRes.data ?? []).length;

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

  const loadRestaurantProfile = useCallback(async (uid: string) => {
    try {
      const { data, error } = await supabase
        .from("restaurant_profiles")
        .select("restaurant_name,is_accepting_orders")
        .eq("user_id", uid)
        .maybeSingle();

      if (error) {
        console.log("Restaurant profile load error:", error);
        return;
      }

      const profile = (data as RestaurantProfileLite | null) ?? null;
      const nextName = String(profile?.restaurant_name || "").trim();

      if (nextName) {
        setRestaurantName(nextName);
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
  }, [checkingAuth, loadDashboardStats]);

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
      require("../../assets/sounds/new-order.wav"),
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

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 18,
          paddingBottom: 32,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            activeOpacity={0.85}
            style={{
              paddingVertical: 8,
              paddingRight: 10,
            }}
          >
            <Text style={{ color: "#93C5FD", fontWeight: "900", fontSize: 18 }}>
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
              onPress={() => void loadDashboardStats()}
              borderColor="#1F2937"
              backgroundColor="#08112A"
              textColor="#E5E7EB"
              disabled={statsLoading}
            />
          </View>
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: 18,
          }}
        >
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text
              style={{
                color: "white",
                fontSize: 26,
                fontWeight: "900",
                lineHeight: 32,
              }}
            >
              {t("restaurant.dashboard.title", "Restaurant Dashboard")}
            </Text>
          </View>

          <View
            style={{
              width: 96,
              alignItems: "center",
              justifyContent: "center",
              marginTop: 2,
            }}
          >
            <BrandMark />
          </View>

          <View style={{ alignItems: "center", width: 132 }}>
            <Text
              numberOfLines={1}
              style={{
                color: "white",
                fontSize: 16,
                fontWeight: "800",
                marginBottom: 8,
                maxWidth: 132,
              }}
            >
              {restaurantName}
            </Text>

            <View
              style={{
                width: 58,
                height: 58,
                borderRadius: 29,
                backgroundColor: "#0B1220",
                borderWidth: 1,
                borderColor: "#1F2937",
                alignItems: "center",
                justifyContent: "center",
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

            <View
              style={{
                marginTop: 10,
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
            color: "#6B7280",
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
      </ScrollView>
    </SafeAreaView>
  );
}
