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
  ScrollView,
  ActivityIndicator,
  Image,
  RefreshControl,
  Pressable,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";
import { useTranslation } from "react-i18next";
import { setLocaleForRoleAndApply } from "../i18n";

type Nav = NativeStackNavigationProp<RootStackParamList, "ClientHome">;

type OrderStatus =
  | "pending"
  | "accepted"
  | "prepared"
  | "ready"
  | "dispatched"
  | "delivered"
  | "canceled";

type OrderRow = {
  id: string;
  status: OrderStatus;
  created_at: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_miles: number | null;
  total: number | null;
  delivery_fee: number | null;
};

type OrderRowDb = {
  id?: unknown;
  status?: unknown;
  created_at?: unknown;
  pickup_address?: unknown;
  dropoff_address?: unknown;
  distance_miles?: unknown;
  total?: unknown;
  delivery_fee?: unknown;
  created_by?: unknown;
};

type ErrorState =
  | null
  | {
      key: string;
      fallback: string;
      params?: Record<string, unknown>;
    };

const FETCH_LIMIT = 10;
const HOME_RECENT_LIMIT = 3;
const DEFAULT_NAME = "Mamadou";
const DEFAULT_CLIENT_NAME = "Client";
const DEFAULT_AVATAR_BG = "#0F172A";

function isInProgress(status: OrderStatus) {
  return (
    status === "pending" ||
    status === "accepted" ||
    status === "prepared" ||
    status === "ready" ||
    status === "dispatched"
  );
}

function isDelivered(status: OrderStatus) {
  return status === "delivered";
}

function isCanceled(status: OrderStatus) {
  return status === "canceled";
}

function statusPillStyles(status: OrderStatus) {
  if (status === "delivered") {
    return {
      bg: "rgba(34,197,94,0.16)",
      border: "rgba(34,197,94,0.35)",
      text: "#86EFAC",
    };
  }

  if (status === "canceled") {
    return {
      bg: "rgba(248,113,113,0.14)",
      border: "rgba(248,113,113,0.30)",
      text: "#FCA5A5",
    };
  }

  if (status === "dispatched") {
    return {
      bg: "rgba(59,130,246,0.14)",
      border: "rgba(59,130,246,0.30)",
      text: "#93C5FD",
    };
  }

  return {
    bg: "rgba(148,163,184,0.10)",
    border: "rgba(148,163,184,0.22)",
    text: "#CBD5E1",
  };
}

function orderBullet(status: OrderStatus) {
  if (status === "delivered") return "🟢";
  if (status === "canceled") return "🔴";
  if (status === "dispatched") return "🔵";
  return "🟡";
}

function orderStatusLabelForCard(
  status: OrderStatus,
  ts: (key: string, fallback: string, params?: Record<string, unknown>) => string
) {
  if (status === "dispatched") {
    return `🚙 ${ts("orders.status.dispatched", "On the way")}`;
  }
  if (status === "delivered") {
    return `✅ ${ts("orders.status.delivered", "Delivered")}`;
  }
  if (status === "canceled") {
    return `⛔ ${ts("orders.status.canceled", "Canceled")}`;
  }
  if (status === "accepted") {
    return `👨‍🍳 ${ts("orders.status.accepted", "Accepted")}`;
  }
  if (status === "prepared") {
    return `🍽️ ${ts("orders.status.prepared", "Preparing")}`;
  }
  if (status === "ready") {
    return `📦 ${ts("orders.status.ready", "Ready")}`;
  }
  return `⏳ ${ts("orders.status.pending", "Pending")}`;
}

function progressWidth(points: number, target: number): `${number}%` {
  if (target <= 0) return "0%";
  const percent = Math.max(0, Math.min(100, (points / target) * 100));
  return `${percent}%`;
}

function truncateName(name: string) {
  const clean = (name || "").trim();
  if (!clean) return DEFAULT_NAME;
  if (clean.length <= 14) return clean;
  return `${clean.slice(0, 12)}…`;
}

function getFirstName(name: string) {
  const clean = (name || "").trim();
  if (!clean) return DEFAULT_NAME;
  return clean.split(" ")[0] || DEFAULT_NAME;
}

function getGreeting(ts: (key: string, fallback: string) => string) {
  const hour = new Date().getHours();
  if (hour < 12) return ts("client.home.greeting_morning", "Good morning");
  if (hour < 18) return ts("client.home.greeting_afternoon", "Good afternoon");
  return ts("client.home.greeting_evening", "Good evening");
}

function formatCurrency(amount: number | null | undefined) {
  if (typeof amount !== "number" || Number.isNaN(amount)) return "—";
  return `${amount.toFixed(2)} USD`;
}

function formatDistance(distance: number | null | undefined) {
  if (typeof distance !== "number" || Number.isNaN(distance)) return "—";
  return `${distance.toFixed(1)} mi`;
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function isValidOrderStatus(value: unknown): value is OrderStatus {
  return (
    value === "pending" ||
    value === "accepted" ||
    value === "prepared" ||
    value === "ready" ||
    value === "dispatched" ||
    value === "delivered" ||
    value === "canceled"
  );
}

function toSafeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function toSafeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeOrders(rows: OrderRowDb[] | null | undefined): OrderRow[] {
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      if (typeof row.id !== "string" || !row.id.trim()) return null;
      if (!isValidOrderStatus(row.status)) return null;

      return {
        id: row.id,
        status: row.status,
        created_at: toSafeString(row.created_at),
        pickup_address: toSafeString(row.pickup_address),
        dropoff_address: toSafeString(row.dropoff_address),
        distance_miles: toSafeNumber(row.distance_miles),
        total: toSafeNumber(row.total),
        delivery_fee: toSafeNumber(row.delivery_fee),
      } satisfies OrderRow;
    })
    .filter((item): item is OrderRow => Boolean(item));
}

function isValidImageUri(uri: string | null) {
  if (!uri) return false;
  return /^https?:\/\//i.test(uri);
}

function SectionTitle({
  title,
  right,
}: {
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 12,
      }}
    >
      <Text
        style={{
          color: "white",
          fontSize: 17,
          fontWeight: "900",
        }}
      >
        {title}
      </Text>
      {right}
    </View>
  );
}

function ActionBanner({
  title,
  subtitle,
  emoji,
  tileEmoji,
  backgroundColor,
  borderColor,
  onPress,
}: {
  title: string;
  subtitle: string;
  emoji: string;
  tileEmoji: string;
  backgroundColor: string;
  borderColor: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={{
        borderRadius: 26,
        borderWidth: 1,
        borderColor,
        backgroundColor,
        paddingHorizontal: 18,
        paddingVertical: 18,
        minHeight: 112,
        justifyContent: "center",
        marginBottom: 12,
        shadowColor: "#000",
        shadowOpacity: 0.18,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 4,
      }}
    >
      <View
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: 134,
          borderTopRightRadius: 26,
          borderBottomRightRadius: 26,
          backgroundColor: "rgba(255,255,255,0.04)",
        }}
      />

      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <View style={{ flex: 1, paddingRight: 14 }}>
          <Text
            style={{
              color: "white",
              fontSize: 17,
              fontWeight: "900",
              lineHeight: 22,
            }}
          >
            {emoji} {title}
          </Text>

          <Text
            style={{
              color: "#D1D5DB",
              fontSize: 14,
              marginTop: 8,
            }}
          >
            {subtitle}
          </Text>
        </View>

        <View
          style={{
            width: 84,
            height: 84,
            borderRadius: 24,
            backgroundColor: "rgba(255,255,255,0.07)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.10)",
            alignItems: "center",
            justifyContent: "center",
            marginLeft: 10,
          }}
        >
          <Text style={{ fontSize: 34 }}>{tileEmoji}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function StatCard({
  icon,
  label,
  value,
  bg,
  border,
}: {
  icon: string;
  label: string;
  value: number;
  bg: string;
  border: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: bg,
        padding: 16,
        minHeight: 118,
        justifyContent: "space-between",
      }}
    >
      <Text style={{ fontSize: 22 }}>{icon}</Text>
      <Text style={{ color: "#D1D5DB", fontSize: 13 }}>{label}</Text>
      <Text style={{ color: "white", fontSize: 23, fontWeight: "900" }}>
        {value}
      </Text>
    </View>
  );
}

function FeaturedOrderCard({
  title,
  subtitle,
  order,
  accentColor,
  borderColor,
  backgroundColor,
  emptyTitle,
  emptySubtitle,
  ctaLabel,
  onPress,
  ts,
}: {
  title: string;
  subtitle: string;
  order?: OrderRow;
  accentColor: string;
  borderColor: string;
  backgroundColor: string;
  emptyTitle: string;
  emptySubtitle: string;
  ctaLabel: string;
  onPress: () => void;
  ts: (key: string, fallback: string, params?: Record<string, unknown>) => string;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={{
        borderRadius: 28,
        borderWidth: 1,
        borderColor,
        backgroundColor,
        padding: 18,
        marginBottom: 14,
        shadowColor: "#000",
        shadowOpacity: 0.2,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 8 },
        elevation: 4,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 12,
        }}
      >
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text
            style={{
              color: "white",
              fontSize: 18,
              fontWeight: "900",
            }}
          >
            {title}
          </Text>
          <Text
            style={{
              color: "#CBD5E1",
              fontSize: 13,
              marginTop: 4,
            }}
          >
            {subtitle}
          </Text>
        </View>

        <View
          style={{
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderRadius: 999,
            backgroundColor: "rgba(255,255,255,0.06)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.08)",
          }}
        >
          <Text
            style={{
              color: accentColor,
              fontSize: 12,
              fontWeight: "900",
            }}
          >
            {ctaLabel}
          </Text>
        </View>
      </View>

      {order ? (
        <>
          <Text
            style={{
              color: "#94A3B8",
              fontSize: 12,
              marginBottom: 10,
            }}
          >
            #{order.id.slice(0, 8)} •{" "}
            {order.created_at
              ? new Date(order.created_at).toLocaleDateString()
              : "—"}
          </Text>

          <Text
            style={{
              color: "#D1D5DB",
              fontSize: 14,
              marginBottom: 8,
            }}
            numberOfLines={1}
          >
            Pickup:{" "}
            <Text style={{ color: "white", fontWeight: "900" }}>
              {order.pickup_address ?? "—"}
            </Text>
          </Text>

          <Text
            style={{
              color: "#D1D5DB",
              fontSize: 14,
              marginBottom: 10,
            }}
            numberOfLines={1}
          >
            Dropoff:{" "}
            <Text style={{ color: "white", fontWeight: "900" }}>
              {order.dropoff_address ?? "—"}
            </Text>
          </Text>

          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 4,
            }}
          >
            <Text
              style={{
                color: accentColor,
                fontSize: 13,
                fontWeight: "900",
                flex: 1,
                paddingRight: 10,
              }}
              numberOfLines={1}
            >
              {orderStatusLabelForCard(order.status, ts)}
            </Text>

            <Text
              style={{
                color: "white",
                fontSize: 14,
                fontWeight: "900",
              }}
            >
              {formatCurrency(order.total ?? order.delivery_fee)}
            </Text>
          </View>
        </>
      ) : (
        <View
          style={{
            borderRadius: 20,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.08)",
            backgroundColor: "rgba(255,255,255,0.04)",
            padding: 16,
          }}
        >
          <Text
            style={{
              color: "white",
              fontSize: 15,
              fontWeight: "800",
            }}
          >
            {emptyTitle}
          </Text>
          <Text
            style={{
              color: "#94A3B8",
              fontSize: 13,
              marginTop: 6,
              lineHeight: 19,
            }}
          >
            {emptySubtitle}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function MenuAction({
  label,
  accent,
  onPress,
}: {
  label: string;
  accent?: "default" | "danger";
  onPress: () => void;
}) {
  const isDanger = accent === "danger";

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 14,
        backgroundColor: isDanger
          ? "rgba(127,29,29,0.28)"
          : "rgba(255,255,255,0.04)",
        borderWidth: 1,
        borderColor: isDanger
          ? "rgba(248,113,113,0.20)"
          : "rgba(255,255,255,0.06)",
      }}
    >
      <Text
        style={{
          color: isDanger ? "#FCA5A5" : "#E2E8F0",
          fontSize: 13,
          fontWeight: "900",
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export function ClientHomeScreen() {
  const navigation = useNavigation<Nav>();
  const { t, i18n } = useTranslation();
  void i18n.language;

  const isMountedRef = useRef(true);
  const fetchInFlightRef = useRef(false);
  const signOutInFlightRef = useRef(false);

  const ts = useCallback(
    (key: string, fallback: string, params?: Record<string, unknown>) =>
      String(t(key, fallback as never, params as never)),
    [t]
  );

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [error, setError] = useState<ErrorState>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>("");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!i18n.language || i18n.language === "dev") {
      void setLocaleForRoleAndApply("client", "en");
    }
  }, [i18n.language]);

  useFocusEffect(
    useCallback(() => {
      setMenuOpen(false);
      return () => {
        setMenuOpen(false);
      };
    }, [])
  );

  const fetchOrders = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (fetchInFlightRef.current) return;

    fetchInFlightRef.current = true;

    if (mode === "refresh") {
      if (isMountedRef.current) setRefreshing(true);
    } else {
      if (isMountedRef.current) setLoading(true);
    }

    try {
      if (isMountedRef.current) setError(null);

      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      const session = sessionData?.session;
      if (!session) {
        if (!isMountedRef.current) return;

        setError({
          key: "client.home.errors.must_login",
          fallback: "You must be logged in to see your orders.",
        });
        setOrders([]);
        setAvatarUrl(null);
        setDisplayName("");
        return;
      }

      const user = session.user;
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>;

      const fullName =
        (typeof meta.full_name === "string" && meta.full_name) ||
        (typeof meta.name === "string" && meta.name) ||
        (typeof meta.display_name === "string" && meta.display_name) ||
        user.email ||
        DEFAULT_CLIENT_NAME;

      const nextAvatar =
        (typeof meta.avatar_url === "string" && meta.avatar_url) ||
        (typeof meta.picture === "string" && meta.picture) ||
        (typeof meta.photoURL === "string" && meta.photoURL) ||
        (typeof meta.photo_url === "string" && meta.photo_url) ||
        null;

      const { data, error: ordersError } = await supabase
        .from("orders")
        .select(
          `
            id,
            status,
            created_at,
            pickup_address,
            dropoff_address,
            distance_miles,
            total,
            delivery_fee,
            created_by
          `
        )
        .eq("created_by", user.id)
        .order("created_at", { ascending: false })
        .limit(FETCH_LIMIT);

      if (ordersError) throw ordersError;
      if (!isMountedRef.current) return;

      setDisplayName(String(fullName));
      setAvatarUrl(isValidImageUri(nextAvatar) ? nextAvatar : null);
      setOrders(normalizeOrders((data as OrderRowDb[] | null) ?? []));
    } catch (e: unknown) {
      if (!isMountedRef.current) return;

      const message =
        e instanceof Error
          ? e.message
          : ts("common.errors.unknown", "Unknown error");

      setError({
        key: "client.home.errors.load_failed",
        fallback: "Unable to load your orders right now.",
        params: { message },
      });
    } finally {
      fetchInFlightRef.current = false;

      if (!isMountedRef.current) return;

      if (mode === "refresh") {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, [ts]);

  useFocusEffect(
    useCallback(() => {
      void fetchOrders("load");
    }, [fetchOrders])
  );

  const stats = useMemo(() => {
    const totalOrders = orders.length;
    const inProgress = orders.filter((o) => isInProgress(o.status)).length;
    const delivered = orders.filter((o) => isDelivered(o.status)).length;
    const canceled = orders.filter((o) => isCanceled(o.status)).length;
    const now = Date.now();

    const last24h = orders.filter((o) => {
      if (!o.created_at) return false;
      const time = new Date(o.created_at).getTime();
      return !Number.isNaN(time) && now - time <= 24 * 60 * 60 * 1000;
    }).length;

    const points = delivered * 10 + inProgress * 2;

    let level: "Bronze" | "Silver" | "Gold" = "Bronze";
    if (points >= 120) level = "Gold";
    else if (points >= 50) level = "Silver";

    const nextLevelTarget =
      level === "Bronze" ? 50 : level === "Silver" ? 120 : 200;

    const pointsToNext = Math.max(0, nextLevelTarget - points);

    const last7dDelivered = orders.filter((o) => {
      if (!o.created_at) return false;
      const time = new Date(o.created_at).getTime();
      const inLast7d =
        !Number.isNaN(time) && now - time <= 7 * 24 * 60 * 60 * 1000;
      return inLast7d && isDelivered(o.status);
    }).length;

    const missionTarget = 3;

    return {
      totalOrders,
      inProgress,
      delivered,
      canceled,
      last24h,
      points,
      level,
      nextLevelTarget,
      pointsToNext,
      last7dDelivered,
      missionTarget,
    };
  }, [orders]);

  const initials = useMemo(() => {
    const base = (displayName || DEFAULT_CLIENT_NAME).trim();
    const parts = base.split(" ").filter(Boolean);
    const a = parts[0]?.[0] ?? "C";
    const b = parts.length > 1 ? parts[1]?.[0] ?? "" : "";
    return (a + b).toUpperCase();
  }, [displayName]);

  const currentLang = (i18n.language || "en").split("-")[0];

  const changeLang = useCallback(
    async (lang: "en" | "fr" | "es") => {
      try {
        await setLocaleForRoleAndApply("client", lang);
      } catch {
        try {
          await i18n.changeLanguage(lang);
        } catch {
          if (!isMountedRef.current) return;
          setError({
            key: "client.home.errors.lang_change_failed",
            fallback: "Unable to change language right now.",
          });
        }
      }
    },
    [i18n]
  );

  const handleGoToRoleSelect = useCallback(() => {
    setMenuOpen(false);
    navigation.reset({
      index: 0,
      routes: [{ name: "RoleSelect" as never }],
    });
  }, [navigation]);

  const handleSignOut = useCallback(async () => {
    if (signOutInFlightRef.current) return;
    signOutInFlightRef.current = true;

    try {
      if (isMountedRef.current) {
        setError(null);
        setMenuOpen(false);
      }

      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;

      if (!isMountedRef.current) return;

      navigation.reset({
        index: 0,
        routes: [{ name: "RoleSelect" as never }],
      });
    } catch (e: unknown) {
      if (!isMountedRef.current) return;

      const message =
        e instanceof Error
          ? e.message
          : ts("common.errors.unknown", "Unknown error");

      setError({
        key: "client.home.errors.signout_failed",
        fallback: "Unable to sign out right now.",
        params: { message },
      });
    } finally {
      signOutInFlightRef.current = false;
    }
  }, [navigation, ts]);

  const progressBarWidth = progressWidth(stats.points, stats.nextLevelTarget);
  const missionBarWidth = progressWidth(
    stats.last7dDelivered,
    stats.missionTarget
  );

  const quickStats = useMemo(
    () => [
      {
        icon: "📦",
        label: ts("client.home.stats.total", "Orders"),
        value: stats.totalOrders,
        bg: "rgba(30,64,175,0.24)",
        border: "rgba(59,130,246,0.22)",
      },
      {
        icon: "🚕",
        label: ts("client.home.stats.in_progress", "In Progress"),
        value: stats.inProgress,
        bg: "rgba(120,53,15,0.26)",
        border: "rgba(251,146,60,0.22)",
      },
      {
        icon: "✅",
        label: ts("client.home.stats.delivered", "Completed"),
        value: stats.delivered,
        bg: "rgba(4,120,87,0.24)",
        border: "rgba(52,211,153,0.22)",
      },
    ],
    [stats.totalOrders, stats.inProgress, stats.delivered, ts]
  );

  const recentOrders = useMemo(
    () => orders.slice(0, HOME_RECENT_LIMIT),
    [orders]
  );

  const featuredOrder = recentOrders[0];
  const activeOrder = useMemo(
    () => orders.find((o) => isInProgress(o.status)),
    [orders]
  );
  const lastDeliveredOrder = useMemo(
    () => orders.find((o) => isDelivered(o.status)),
    [orders]
  );
  const greeting = getGreeting(ts);
  const firstName = getFirstName(displayName || DEFAULT_NAME);

  const handleOpenFeaturedOrder = useCallback(() => {
    const target = activeOrder ?? lastDeliveredOrder ?? featuredOrder;
    if (!target?.id) return;

    navigation.navigate("ClientOrderDetails", {
      orderId: target.id,
    });
  }, [activeOrder, featuredOrder, lastDeliveredOrder, navigation]);

  const handleOpenChat = useCallback(
    (orderId: string) => {
      navigation.navigate("ClientChat", { orderId });
    },
    [navigation]
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#030617" }}>
      <StatusBar barStyle="light-content" />

      <Pressable
        style={{ flex: 1 }}
        onPress={() => {
          if (menuOpen) setMenuOpen(false);
        }}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 14,
            paddingTop: 12,
            paddingBottom: 30,
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                void fetchOrders("refresh");
              }}
              tintColor="#ffffff"
            />
          }
        >
          <View
            style={{
              borderRadius: 32,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.06)",
              backgroundColor: "#040a23",
              padding: 14,
              shadowColor: "#000",
              shadowOpacity: 0.32,
              shadowRadius: 22,
              shadowOffset: { width: 0, height: 10 },
              elevation: 10,
            }}
          >
            <View
              style={{
                position: "relative",
                zIndex: 20,
                flexDirection: "row",
                alignItems: "flex-start",
                justifyContent: "space-between",
                marginBottom: 16,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  flex: 1,
                  marginRight: 10,
                }}
              >
                {avatarUrl ? (
                  <Image
                    source={{ uri: avatarUrl }}
                    style={{
                      width: 54,
                      height: 54,
                      borderRadius: 27,
                      borderWidth: 1,
                      borderColor: "rgba(255,255,255,0.10)",
                      backgroundColor: DEFAULT_AVATAR_BG,
                    }}
                  />
                ) : (
                  <View
                    style={{
                      width: 54,
                      height: 54,
                      borderRadius: 27,
                      backgroundColor: "rgba(59,130,246,0.18)",
                      borderWidth: 1,
                      borderColor: "rgba(96,165,250,0.20)",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text
                      style={{
                        color: "#DBEAFE",
                        fontSize: 18,
                        fontWeight: "900",
                      }}
                    >
                      {initials}
                    </Text>
                  </View>
                )}

                <View style={{ marginLeft: 12, flex: 1 }}>
                  <Text
                    style={{
                      color: "#94A3B8",
                      fontSize: 13,
                      fontWeight: "700",
                    }}
                    numberOfLines={1}
                  >
                    {greeting}
                  </Text>

                  <Text
                    style={{
                      color: "white",
                      fontSize: 22,
                      fontWeight: "900",
                      marginTop: 2,
                    }}
                    numberOfLines={1}
                  >
                    {truncateName(firstName)}
                  </Text>

                  <Text
                    style={{
                      color: "#CBD5E1",
                      fontSize: 12,
                      marginTop: 4,
                    }}
                    numberOfLines={1}
                  >
                    {ts(
                      "client.home.header.subtitle",
                      "Manage your deliveries and orders in one place."
                    )}
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                }}
                style={{
                  alignItems: "flex-end",
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: 8,
                  }}
                >
                  {(["en", "fr", "es"] as const).map((lang) => {
                    const active = currentLang === lang;
                    return (
                      <TouchableOpacity
                        key={lang}
                        activeOpacity={0.9}
                        onPress={() => {
                          void changeLang(lang);
                        }}
                        style={{
                          minWidth: 40,
                          paddingHorizontal: 10,
                          paddingVertical: 8,
                          borderRadius: 999,
                          backgroundColor: active
                            ? "rgba(59,130,246,0.20)"
                            : "rgba(255,255,255,0.05)",
                          borderWidth: 1,
                          borderColor: active
                            ? "rgba(96,165,250,0.32)"
                            : "rgba(255,255,255,0.08)",
                          alignItems: "center",
                        }}
                      >
                        <Text
                          style={{
                            color: active ? "#DBEAFE" : "#CBD5E1",
                            fontSize: 12,
                            fontWeight: "900",
                            textTransform: "uppercase",
                          }}
                        >
                          {lang}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => {
                    setMenuOpen((prev) => !prev);
                  }}
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 21,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "rgba(255,255,255,0.06)",
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.10)",
                  }}
                >
                  <Text
                    style={{
                      color: "#E2E8F0",
                      fontSize: 18,
                      fontWeight: "900",
                    }}
                  >
                    ⋯
                  </Text>
                </TouchableOpacity>

                {menuOpen ? (
                  <View
                    style={{
                      position: "absolute",
                      top: 54,
                      right: 0,
                      width: 190,
                      borderRadius: 18,
                      padding: 10,
                      backgroundColor: "#0B1220",
                      borderWidth: 1,
                      borderColor: "rgba(255,255,255,0.08)",
                      shadowColor: "#000",
                      shadowOpacity: 0.28,
                      shadowRadius: 16,
                      shadowOffset: { width: 0, height: 8 },
                      elevation: 12,
                    }}
                  >
                    <Text
                      style={{
                        color: "#94A3B8",
                        fontSize: 11,
                        fontWeight: "800",
                        textTransform: "uppercase",
                        marginBottom: 10,
                        paddingHorizontal: 4,
                      }}
                    >
                      Account
                    </Text>

                    <MenuAction
                      label="Switch role"
                      onPress={handleGoToRoleSelect}
                    />

                    <View style={{ height: 8 }} />

                    <MenuAction
                      label={
                        signOutInFlightRef.current ? "Signing out..." : "Logout"
                      }
                      accent="danger"
                      onPress={() => {
                        void handleSignOut();
                      }}
                    />
                  </View>
                ) : null}
              </Pressable>
            </View>

            <View
              style={{
                borderRadius: 26,
                padding: 16,
                marginBottom: 14,
                backgroundColor: "rgba(15,23,42,0.92)",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.06)",
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    color: "white",
                    fontSize: 17,
                    fontWeight: "900",
                  }}
                >
                  {ts("client.home.loyalty.title", "Loyalty progress")}
                </Text>

                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: "rgba(59,130,246,0.16)",
                    borderWidth: 1,
                    borderColor: "rgba(96,165,250,0.24)",
                  }}
                >
                  <Text
                    style={{
                      color: "#BFDBFE",
                      fontSize: 12,
                      fontWeight: "900",
                    }}
                  >
                    {stats.level}
                  </Text>
                </View>
              </View>

              <View
                style={{
                  marginTop: 12,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Text
                  style={{
                    color: "#CBD5E1",
                    fontSize: 13,
                  }}
                >
                  {ts("client.home.loyalty.score", "Your score")}
                </Text>

                <Text
                  style={{
                    color: "white",
                    fontSize: 13,
                    fontWeight: "700",
                  }}
                >
                  {stats.points} pts
                </Text>
              </View>

              <View
                style={{
                  marginTop: 12,
                  height: 10,
                  borderRadius: 999,
                  backgroundColor: "rgba(255,255,255,0.07)",
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    width: progressBarWidth,
                    height: "100%",
                    borderRadius: 999,
                    backgroundColor: "#3B82F6",
                  }}
                />
              </View>

              <Text
                style={{
                  color: "#94A3B8",
                  fontSize: 12,
                  marginTop: 10,
                }}
              >
                {stats.pointsToNext > 0
                  ? ts(
                      "client.home.loyalty.next",
                      `${stats.pointsToNext} pts to next level`
                    )
                  : ts("client.home.loyalty.max", "You are progressing strongly")}
              </Text>
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
              {quickStats.map((item) => (
                <StatCard
                  key={item.label}
                  icon={item.icon}
                  label={item.label}
                  value={item.value}
                  bg={item.bg}
                  border={item.border}
                />
              ))}
            </View>

            <ActionBanner
              title={ts("client.home.new_order.title", "New Pickup / Dropoff")}
              subtitle={ts(
                "client.home.new_order.subtitle",
                "Create a new delivery in seconds."
              )}
              emoji="⚡"
              tileEmoji="📦"
              backgroundColor="rgba(37,99,235,0.20)"
              borderColor="rgba(96,165,250,0.24)"
              onPress={() => navigation.navigate("ClientNewOrder")}
            />

            <ActionBanner
              title={ts("client.home.restaurants.title", "Order from restaurants")}
              subtitle={ts(
                "client.home.restaurants.subtitle",
                "Browse restaurants and place an order fast."
              )}
              emoji="🍔"
              tileEmoji="🛍️"
              backgroundColor="rgba(22,101,52,0.20)"
              borderColor="rgba(74,222,128,0.24)"
              onPress={() => navigation.navigate("ClientRestaurantList")}
            />

            <FeaturedOrderCard
              title={ts("client.home.featured.active_title", "Active order")}
              subtitle={ts(
                "client.home.featured.active_subtitle",
                "Track the order currently moving through the system."
              )}
              order={activeOrder}
              accentColor="#93C5FD"
              borderColor="rgba(96,165,250,0.22)"
              backgroundColor="rgba(30,41,59,0.92)"
              emptyTitle={ts("client.home.active.empty_title", "No active order")}
              emptySubtitle={ts(
                "client.home.active.empty_subtitle",
                "Your next live order will appear here for instant tracking."
              )}
              ctaLabel={ts("client.home.open", "Open")}
              onPress={handleOpenFeaturedOrder}
              ts={ts}
            />

            <FeaturedOrderCard
              title={ts("client.home.featured.completed_title", "Last completed")}
              subtitle={ts(
                "client.home.featured.completed_subtitle",
                "Your most recent finished delivery."
              )}
              order={lastDeliveredOrder}
              accentColor="#86EFAC"
              borderColor="rgba(52,211,153,0.22)"
              backgroundColor="rgba(6,78,59,0.28)"
              emptyTitle={ts(
                "client.home.completed.empty_title",
                "No completed order yet"
              )}
              emptySubtitle={ts(
                "client.home.completed.empty_subtitle",
                "Once a delivery is completed, it will appear here."
              )}
              ctaLabel={ts("client.home.details", "Details")}
              onPress={handleOpenFeaturedOrder}
              ts={ts}
            />

            <View
              style={{
                borderRadius: 24,
                padding: 16,
                marginBottom: 14,
                backgroundColor: "rgba(17,24,39,0.95)",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.06)",
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <Text
                  style={{
                    color: "white",
                    fontSize: 16,
                    fontWeight: "900",
                  }}
                >
                  {ts("client.home.weekly_challenge", "Weekly challenge")}
                </Text>

                <Text
                  style={{
                    color: "#FDE68A",
                    fontSize: 12,
                    fontWeight: "900",
                  }}
                >
                  {stats.last7dDelivered}/{stats.missionTarget}
                </Text>
              </View>

              <Text
                style={{
                  color: "#94A3B8",
                  fontSize: 13,
                }}
              >
                {ts(
                  "client.home.weekly_challenge_subtitle",
                  "Complete deliveries this week to keep your activity strong."
                )}
              </Text>

              <View
                style={{
                  marginTop: 12,
                  height: 10,
                  borderRadius: 999,
                  backgroundColor: "rgba(255,255,255,0.07)",
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    width: missionBarWidth,
                    height: "100%",
                    borderRadius: 999,
                    backgroundColor: "#F59E0B",
                  }}
                />
              </View>

              <Text
                style={{
                  color: "#CBD5E1",
                  fontSize: 12,
                  marginTop: 10,
                }}
              >
                {stats.last7dDelivered >= stats.missionTarget
                  ? ts(
                      "client.home.weekly_done",
                      "Challenge completed. Great job."
                    )
                  : ts(
                      "client.home.weekly_remaining",
                      `${Math.max(
                        0,
                        stats.missionTarget - stats.last7dDelivered
                      )} more to complete the challenge`
                    )}
              </Text>
            </View>

            {loading && !refreshing && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <ActivityIndicator color="#ffffff" />
                <Text style={{ color: "#9CA3AF", fontSize: 13, marginLeft: 8 }}>
                  {ts("client.home.loading_orders", "Loading your orders.")}
                </Text>
              </View>
            )}

            {error && (
              <View
                style={{
                  marginBottom: 12,
                  borderRadius: 16,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  backgroundColor: "rgba(127,29,29,0.30)",
                  borderWidth: 1,
                  borderColor: "rgba(248,113,113,0.24)",
                }}
              >
                <Text
                  style={{ color: "#FCA5A5", fontSize: 12, fontWeight: "700" }}
                >
                  {ts(error.key, error.fallback, error.params)}
                </Text>

                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => {
                    void fetchOrders("load");
                  }}
                  style={{
                    marginTop: 10,
                    alignSelf: "flex-start",
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 999,
                    backgroundColor: "rgba(255,255,255,0.06)",
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.08)",
                  }}
                >
                  <Text
                    style={{
                      color: "white",
                      fontSize: 12,
                      fontWeight: "900",
                    }}
                  >
                    {ts("common.retry", "Retry")}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            <SectionTitle
              title={ts("client.home.recent_orders", "Recent orders")}
              right={
                <TouchableOpacity
                  onPress={() => navigation.navigate("ClientNewOrder")}
                  style={{
                    paddingHorizontal: 18,
                    paddingVertical: 10,
                    borderRadius: 999,
                    backgroundColor: "#38A169",
                    borderWidth: 1,
                    borderColor: "rgba(134,239,172,0.18)",
                  }}
                >
                  <Text
                    style={{
                      color: "white",
                      fontWeight: "900",
                      fontSize: 14,
                    }}
                  >
                    {ts("client.home.new_order_short", "＋ New Order")}
                  </Text>
                </TouchableOpacity>
              }
            />

            {orders.length === 0 && !loading ? (
              <View style={{ paddingVertical: 20, alignItems: "center" }}>
                <Text
                  style={{
                    color: "#9CA3AF",
                    fontSize: 13,
                    textAlign: "center",
                  }}
                >
                  {ts("client.home.empty.title", "No orders yet for this account.")}
                </Text>
                <Text
                  style={{
                    color: "#6B7280",
                    fontSize: 12,
                    marginTop: 6,
                    textAlign: "center",
                  }}
                >
                  {ts(
                    "client.home.empty.subtitle",
                    "Create a pickup/dropoff order or order from a restaurant to test the system."
                  )}
                </Text>
              </View>
            ) : (
              recentOrders.map((order) => {
                const pill = statusPillStyles(order.status);

                return (
                  <TouchableOpacity
                    key={order.id}
                    activeOpacity={0.92}
                    onPress={() =>
                      navigation.navigate("ClientOrderDetails", {
                        orderId: order.id,
                      })
                    }
                    style={{
                      borderRadius: 24,
                      borderWidth: 1,
                      borderColor: "rgba(255,255,255,0.06)",
                      backgroundColor: "rgba(15,23,42,0.94)",
                      padding: 16,
                      marginBottom: 12,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                      }}
                    >
                      <View style={{ flex: 1, paddingRight: 14 }}>
                        <Text
                          style={{
                            color: "white",
                            fontSize: 15,
                            fontWeight: "900",
                          }}
                          numberOfLines={1}
                        >
                          {orderBullet(order.status)} #{order.id.slice(0, 8)}
                        </Text>

                        <Text
                          style={{
                            color: "#94A3B8",
                            fontSize: 12,
                            marginTop: 5,
                          }}
                        >
                          {formatDateTime(order.created_at)}
                        </Text>

                        <Text
                          style={{
                            color: "#D1D5DB",
                            fontSize: 13,
                            marginTop: 10,
                          }}
                          numberOfLines={1}
                        >
                          Pickup:{" "}
                          <Text style={{ color: "white", fontWeight: "800" }}>
                            {order.pickup_address ?? "—"}
                          </Text>
                        </Text>

                        <Text
                          style={{
                            color: "#D1D5DB",
                            fontSize: 13,
                            marginTop: 6,
                          }}
                          numberOfLines={1}
                        >
                          Dropoff:{" "}
                          <Text style={{ color: "white", fontWeight: "800" }}>
                            {order.dropoff_address ?? "—"}
                          </Text>
                        </Text>

                        <View
                          style={{
                            flexDirection: "row",
                            flexWrap: "wrap",
                            marginTop: 10,
                            gap: 8,
                          }}
                        >
                          <Text
                            style={{
                              color: "#93C5FD",
                              fontSize: 12,
                              fontWeight: "800",
                            }}
                          >
                            📍 {formatDistance(order.distance_miles)}
                          </Text>

                          <Text
                            style={{
                              color: "#FDE68A",
                              fontSize: 12,
                              fontWeight: "800",
                            }}
                          >
                            💵 {formatCurrency(order.total ?? order.delivery_fee)}
                          </Text>
                        </View>
                      </View>

                      <View style={{ alignItems: "flex-end" }}>
                        <TouchableOpacity
                          onPress={() => handleOpenChat(order.id)}
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 20,
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: "rgba(255,255,255,0.05)",
                            borderWidth: 1,
                            borderColor: "rgba(255,255,255,0.08)",
                          }}
                        >
                          <Text
                            style={{
                              color: "#E5E7EB",
                              fontSize: 17,
                              fontWeight: "900",
                            }}
                          >
                            💬
                          </Text>
                        </TouchableOpacity>

                        <View
                          style={{
                            marginTop: 12,
                            paddingHorizontal: 12,
                            paddingVertical: 7,
                            borderRadius: 999,
                            backgroundColor: pill.bg,
                            borderWidth: 1,
                            borderColor: pill.border,
                            maxWidth: 150,
                          }}
                        >
                          <Text
                            numberOfLines={1}
                            style={{
                              color: pill.text,
                              fontSize: 12,
                              fontWeight: "900",
                            }}
                          >
                            {orderStatusLabelForCard(order.status, ts)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}

            {orders.length > HOME_RECENT_LIMIT && (
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={handleOpenFeaturedOrder}
                style={{
                  marginTop: 2,
                  alignSelf: "center",
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  borderRadius: 999,
                  backgroundColor: "rgba(255,255,255,0.06)",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.08)",
                }}
              >
                <Text
                  style={{
                    color: "white",
                    fontWeight: "800",
                    fontSize: 13,
                  }}
                >
                  {ts("client.home.see_more", "Open highlighted order")}
                </Text>
              </TouchableOpacity>
            )}

            <View style={{ height: 6 }} />
          </View>
        </ScrollView>
      </Pressable>
    </SafeAreaView>
  );
}

export default ClientHomeScreen;