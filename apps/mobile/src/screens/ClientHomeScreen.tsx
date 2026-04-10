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

type ItemKind = "restaurant_order" | "delivery_request";

type ClientItem = {
  id: string;
  kind: ItemKind;
  status: OrderStatus;
  payment_status: string | null;
  created_at: string | null;
  updated_at: string | null;
  paid_at: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_miles: number | null;
  total: number | null;
  delivery_fee: number | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
};

type OrderRowDb = {
  id?: unknown;
  status?: unknown;
  payment_status?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  paid_at?: unknown;
  pickup_address?: unknown;
  dropoff_address?: unknown;
  distance_miles?: unknown;
  total?: unknown;
  delivery_fee?: unknown;
  stripe_session_id?: unknown;
  stripe_payment_intent_id?: unknown;
  client_user_id?: unknown;
  created_by?: unknown;
};

type DeliveryRequestRowDb = {
  id?: unknown;
  status?: unknown;
  payment_status?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  paid_at?: unknown;
  pickup_address?: unknown;
  dropoff_address?: unknown;
  distance_miles?: unknown;
  total?: unknown;
  delivery_fee?: unknown;
  stripe_session_id?: unknown;
  stripe_payment_intent_id?: unknown;
  client_user_id?: unknown;
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
const HOME_RECENT_LIMIT = 10;
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

function kindEmoji(kind: ItemKind) {
  return kind === "delivery_request" ? "🚗" : "🍔";
}

function kindLabel(
  kind: ItemKind,
  ts: (key: string, fallback: string, params?: Record<string, unknown>) => string
) {
  return kind === "delivery_request"
    ? ts("client.home.kind.delivery_request", "Delivery request")
    : ts("client.home.kind.restaurant_order", "Restaurant order");
}

function orderStatusLabelForCard(
  item: ClientItem,
  ts: (key: string, fallback: string, params?: Record<string, unknown>) => string
) {
  if (item.kind === "delivery_request") {
    if (item.payment_status === "paid" && item.status === "pending") {
      return `💳 ${ts(
        "delivery_requests.status.paid_pending",
        "Paid • Waiting for a driver"
      )}`;
    }
    if (item.payment_status === "processing" && item.status === "pending") {
      return `⏳ ${ts(
        "delivery_requests.status.processing_pending",
        "Payment processing"
      )}`;
    }
    if (item.payment_status === "unpaid") {
      return `💤 ${ts("delivery_requests.status.unpaid", "Unpaid")}`;
    }
  }

  if (item.status === "dispatched") {
    return `🚙 ${ts("orders.status.dispatched", "On the way")}`;
  }
  if (item.status === "delivered") {
    return `✅ ${ts("orders.status.delivered", "Delivered")}`;
  }
  if (item.status === "canceled") {
    return `⛔ ${ts("orders.status.canceled", "Canceled")}`;
  }
  if (item.status === "accepted") {
    return `👨‍🍳 ${ts("orders.status.accepted", "Accepted")}`;
  }
  if (item.status === "prepared") {
    return `🍽️ ${ts("orders.status.prepared", "Preparing")}`;
  }
  if (item.status === "ready") {
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
  if (!clean) return DEFAULT_CLIENT_NAME;
  if (clean.length <= 14) return clean;
  return `${clean.slice(0, 12)}…`;
}

function getFirstName(name: string) {
  const clean = (name || "").trim();
  if (!clean) return DEFAULT_CLIENT_NAME;
  return clean.split(" ")[0] || DEFAULT_CLIENT_NAME;
}

function getGreeting(ts: (key: string, fallback: string) => string) {
  const hour = new Date().getHours();
  if (hour < 12) return ts("client.home.greeting_morning", "Good morning");
  if (hour < 18) return ts("client.home.greeting_afternoon", "Good afternoon");
  return ts("client.home.greeting_evening", "Good evening");
}

function formatCurrency(amount: number | null | undefined) {
  if (typeof amount !== "number" || Number.isNaN(amount)) return "—";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
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
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim() && !Number.isNaN(Number(value))
    ? Number(value)
    : null;
}

function normalizeOrderRows(rows: OrderRowDb[] | null | undefined): ClientItem[] {
  if (!Array.isArray(rows)) return [];

  const result: ClientItem[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (typeof row.id !== "string" || !row.id.trim()) continue;
    if (!isValidOrderStatus(row.status)) continue;

    result.push({
      id: row.id,
      kind: "restaurant_order",
      status: row.status,
      payment_status: toSafeString(row.payment_status),
      created_at: toSafeString(row.created_at),
      updated_at: toSafeString(row.updated_at),
      paid_at: toSafeString(row.paid_at),
      pickup_address: toSafeString(row.pickup_address),
      dropoff_address: toSafeString(row.dropoff_address),
      distance_miles: toSafeNumber(row.distance_miles),
      total: toSafeNumber(row.total),
      delivery_fee: toSafeNumber(row.delivery_fee),
      stripe_session_id: toSafeString(row.stripe_session_id),
      stripe_payment_intent_id: toSafeString(row.stripe_payment_intent_id),
    });
  }

  return result;
}

function normalizeDeliveryRequestRows(
  rows: DeliveryRequestRowDb[] | null | undefined
): ClientItem[] {
  if (!Array.isArray(rows)) return [];

  const result: ClientItem[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (typeof row.id !== "string" || !row.id.trim()) continue;
    if (!isValidOrderStatus(row.status)) continue;

    result.push({
      id: row.id,
      kind: "delivery_request",
      status: row.status,
      payment_status: toSafeString(row.payment_status),
      created_at: toSafeString(row.created_at),
      updated_at: toSafeString(row.updated_at),
      paid_at: toSafeString(row.paid_at),
      pickup_address: toSafeString(row.pickup_address),
      dropoff_address: toSafeString(row.dropoff_address),
      distance_miles: toSafeNumber(row.distance_miles),
      total: toSafeNumber(row.total),
      delivery_fee: toSafeNumber(row.delivery_fee),
      stripe_session_id: toSafeString(row.stripe_session_id),
      stripe_payment_intent_id: toSafeString(row.stripe_payment_intent_id),
    });
  }

  return result;
}

function sortClientItems(items: ClientItem[]) {
  return [...items].sort((a, b) => {
    const aRaw = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bRaw = b.created_at ? new Date(b.created_at).getTime() : 0;

    const aTime = Number.isFinite(aRaw) ? aRaw : 0;
    const bTime = Number.isFinite(bRaw) ? bRaw : 0;

    return bTime - aTime;
  });
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
  order?: ClientItem;
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
            {kindEmoji(order.kind)} #{order.id.slice(0, 8)} •{" "}
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
            {ts("client.home.labels.pickup", "Pickup")}:{" "}
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
            {ts("client.home.labels.dropoff", "Dropoff")}:{" "}
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
              {orderStatusLabelForCard(order, ts)}
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
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(
    null
  );

  const ts = useCallback(
    (key: string, fallback: string, params?: Record<string, unknown>) =>
      String(t(key, fallback as never, params as never)),
    [t]
  );

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<ClientItem[]>([]);
  const [error, setError] = useState<ErrorState>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>("");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
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

  const fetchAllForUser = useCallback(async (userId: string) => {
    const [ordersRes, requestsRes] = await Promise.all([
      supabase
        .from("orders")
        .select(
          `
            id,
            status,
            payment_status,
            created_at,
            updated_at,
            paid_at,
            pickup_address,
            dropoff_address,
            distance_miles,
            total,
            delivery_fee,
            stripe_session_id,
            stripe_payment_intent_id,
            client_user_id
          `
        )
        .eq("client_user_id", userId)
        .order("created_at", { ascending: false })
        .limit(FETCH_LIMIT),

      supabase
        .from("delivery_requests")
        .select(
          `
            id,
            status,
            payment_status,
            created_at,
            updated_at,
            paid_at,
            pickup_address,
            dropoff_address,
            distance_miles,
            total,
            delivery_fee,
            stripe_session_id,
            stripe_payment_intent_id,
            client_user_id,
            created_by
          `
        )
        .or(`client_user_id.eq.${userId},created_by.eq.${userId}`)
        .order("created_at", { ascending: false })
        .limit(FETCH_LIMIT),
    ]);

    if (ordersRes.error) throw ordersRes.error;
    if (requestsRes.error) throw requestsRes.error;

    const normalizedOrders = normalizeOrderRows(
      (ordersRes.data as OrderRowDb[] | null) ?? []
    );
    const normalizedRequests = normalizeDeliveryRequestRows(
      (requestsRes.data as DeliveryRequestRowDb[] | null) ?? []
    );

    return sortClientItems([...normalizedOrders, ...normalizedRequests]);
  }, []);

  const fetchOrders = useCallback(
    async (mode: "load" | "refresh" = "load", silent = false) => {
      if (fetchInFlightRef.current) return;

      fetchInFlightRef.current = true;

      if (!silent) {
        if (mode === "refresh") {
          if (isMountedRef.current) setRefreshing(true);
        } else {
          if (isMountedRef.current) setLoading(true);
        }
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
          setItems([]);
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

        const mergedItems = await fetchAllForUser(user.id);

        if (!isMountedRef.current) return;

        setDisplayName(String(fullName));
        setAvatarUrl(isValidImageUri(nextAvatar) ? nextAvatar : null);
        setItems(mergedItems);

        subscribeRealtime(user.id);
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

        if (!isMountedRef.current || silent) return;

        if (mode === "refresh") {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [fetchAllForUser, ts]
  );

  const subscribeRealtime = useCallback(
    (userId: string) => {
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }

      const channel = supabase
        .channel(`client-home-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "orders",
            filter: `client_user_id=eq.${userId}`,
          },
          () => {
            void fetchOrders("load", true);
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "delivery_requests",
            filter: `client_user_id=eq.${userId}`,
          },
          () => {
            void fetchOrders("load", true);
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "delivery_requests",
            filter: `created_by=eq.${userId}`,
          },
          () => {
            void fetchOrders("load", true);
          }
        )
        .subscribe();

      realtimeChannelRef.current = channel;
    },
    [fetchOrders]
  );

  useFocusEffect(
    useCallback(() => {
      void fetchOrders("load");
    }, [fetchOrders])
  );

  const stats = useMemo(() => {
    const totalOrders = items.length;
    const inProgress = items.filter((o) => isInProgress(o.status)).length;
    const delivered = items.filter((o) => isDelivered(o.status)).length;
    const canceled = items.filter((o) => isCanceled(o.status)).length;
    const now = Date.now();

    const last24h = items.filter((o) => {
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

    const last7dDelivered = items.filter((o) => {
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
  }, [items]);

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
    () => items.slice(0, HOME_RECENT_LIMIT),
    [items]
  );

  const featuredOrder = recentOrders[0];
  const activeOrder = useMemo(
    () => items.find((o) => isInProgress(o.status)),
    [items]
  );
  const lastDeliveredOrder = useMemo(
    () => items.find((o) => isDelivered(o.status)),
    [items]
  );
  const greeting = getGreeting(ts);
  const firstName = getFirstName(displayName || DEFAULT_CLIENT_NAME);

  const handleOpenFeaturedOrder = useCallback(() => {
  const target = activeOrder ?? lastDeliveredOrder ?? featuredOrder;
  if (!target?.id) return;

  if (target.kind === "restaurant_order") {
    navigation.navigate("ClientOrderDetails", {
      orderId: target.id,
    });
    return;
  }

  (navigation as any).navigate("ClientDeliveryRequestDetails", {
    requestId: target.id,
  });
}, [activeOrder, featuredOrder, lastDeliveredOrder, navigation]);

  const handleOpenRestaurantOrder = useCallback(
    (orderId: string) => {
      navigation.navigate("ClientOrderDetails", {
        orderId,
      });
    },
    [navigation]
  );

  const handleOpenChat = useCallback(
    (orderId: string) => {
      navigation.navigate("ClientChat", { orderId } as never);
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
                      label="Sign out"
                      accent="danger"
                      onPress={() => {
                        void handleSignOut();
                      }}
                    />
                  </View>
                ) : null}
              </Pressable>
            </View>

            {error ? (
              <View
                style={{
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: "rgba(248,113,113,0.20)",
                  backgroundColor: "rgba(127,29,29,0.26)",
                  padding: 14,
                  marginBottom: 14,
                }}
              >
                <Text style={{ color: "#FCA5A5", fontWeight: "800" }}>
                  {ts(error.key, error.fallback, error.params)}
                </Text>
              </View>
            ) : null}

            <ActionBanner
              title={ts("client.home.banner.delivery.title", "Request a driver")}
              subtitle={ts(
                "client.home.banner.delivery.subtitle",
                "Book a pickup and dropoff delivery request in seconds."
              )}
              emoji="🚗"
              tileEmoji="📍"
              backgroundColor="rgba(15,23,42,0.88)"
              borderColor="rgba(59,130,246,0.18)"
              onPress={() => navigation.navigate("DeliveryRequest" as never)}
            />

            <ActionBanner
              title={ts("client.home.banner.restaurant.title", "Order food")}
              subtitle={ts(
                "client.home.banner.restaurant.subtitle",
                "Browse restaurants and place an order quickly."
              )}
              emoji="🍔"
              tileEmoji="🛍️"
              backgroundColor="rgba(15,23,42,0.88)"
              borderColor="rgba(251,146,60,0.18)"
              onPress={() => navigation.navigate("ClientRestaurantList" as never)}
            />

            <SectionTitle
              title={ts("client.home.section.overview", "Overview")}
            />

            <View
              style={{
                flexDirection: "row",
                gap: 10,
                marginBottom: 14,
              }}
            >
              {quickStats.map((stat) => (
                <StatCard
                  key={stat.label}
                  icon={stat.icon}
                  label={stat.label}
                  value={stat.value}
                  bg={stat.bg}
                  border={stat.border}
                />
              ))}
            </View>

            <View
              style={{
                borderRadius: 24,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.06)",
                backgroundColor: "rgba(15,23,42,0.9)",
                padding: 16,
                marginBottom: 14,
              }}
            >
              <Text style={{ color: "white", fontSize: 16, fontWeight: "900" }}>
                {ts("client.home.rewards.title", "Rewards progress")}
              </Text>

              <Text style={{ color: "#94A3B8", fontSize: 13, marginTop: 5 }}>
                {ts("client.home.rewards.level", "Level")}: {stats.level} •{" "}
                {stats.points} pts
              </Text>

              <View
                style={{
                  height: 10,
                  borderRadius: 999,
                  overflow: "hidden",
                  backgroundColor: "rgba(255,255,255,0.06)",
                  marginTop: 12,
                }}
              >
                <View
                  style={{
                    width: progressBarWidth,
                    height: "100%",
                    backgroundColor: "#3B82F6",
                  }}
                />
              </View>

              <Text style={{ color: "#CBD5E1", fontSize: 12, marginTop: 8 }}>
                {stats.pointsToNext > 0
                  ? `${stats.pointsToNext} ${ts(
                      "client.home.rewards.to_next",
                      "points to next level"
                    )}`
                  : ts("client.home.rewards.maxed", "You reached the current goal")}
              </Text>

              <View style={{ height: 14 }} />

              <Text style={{ color: "white", fontSize: 15, fontWeight: "900" }}>
                {ts("client.home.mission.title", "Weekly mission")}
              </Text>

              <Text style={{ color: "#94A3B8", fontSize: 13, marginTop: 5 }}>
                {stats.last7dDelivered}/{stats.missionTarget}{" "}
                {ts("client.home.mission.completed", "completed deliveries")}
              </Text>

              <View
                style={{
                  height: 10,
                  borderRadius: 999,
                  overflow: "hidden",
                  backgroundColor: "rgba(255,255,255,0.06)",
                  marginTop: 12,
                }}
              >
                <View
                  style={{
                    width: missionBarWidth,
                    height: "100%",
                    backgroundColor: "#22C55E",
                  }}
                />
              </View>
            </View>

            <FeaturedOrderCard
              title={ts("client.home.highlight.title", "Highlighted order")}
              subtitle={ts(
                "client.home.highlight.subtitle",
                "Your most relevant recent request or order."
              )}
              order={activeOrder ?? lastDeliveredOrder ?? featuredOrder}
              accentColor="#93C5FD"
              borderColor="rgba(96,165,250,0.18)"
              backgroundColor="rgba(15,23,42,0.92)"
              emptyTitle={ts("client.home.empty.title", "Nothing here yet")}
              emptySubtitle={ts(
                "client.home.empty.subtitle",
                "Create a pickup/dropoff order or order from a restaurant to test the system."
              )}
              ctaLabel={ts("client.home.highlight.cta", "Open")}
              onPress={handleOpenFeaturedOrder}
              ts={ts}
            />

            <SectionTitle
              title={ts("client.home.section.recent", "Recent activity")}
              right={
                loading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : undefined
              }
            />

            {items.length === 0 && !loading ? (
              <View
                style={{
                  borderRadius: 24,
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.06)",
                  backgroundColor: "rgba(15,23,42,0.94)",
                  padding: 18,
                  alignItems: "center",
                }}
              >
                <Text style={{ fontSize: 30, marginBottom: 8 }}>📭</Text>
                <Text
                  style={{
                    color: "white",
                    fontSize: 15,
                    fontWeight: "900",
                    textAlign: "center",
                  }}
                >
                  {ts("client.home.empty.title", "Nothing here yet")}
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
                const isRestaurant = order.kind === "restaurant_order";

                return (
                  <TouchableOpacity
                    key={`${order.kind}-${order.id}`}
                    activeOpacity={0.92}
                    onPress={() => {
  if (isRestaurant) {
    handleOpenRestaurantOrder(order.id);
  } else {
    (navigation as any).navigate("ClientDeliveryRequestDetails", {
      requestId: order.id,
    });
  }
}}
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
                          {kindEmoji(order.kind)} {orderBullet(order.status)} #
                          {order.id.slice(0, 8)}
                        </Text>

                        <Text
                          style={{
                            color: "#CBD5E1",
                            fontSize: 12,
                            marginTop: 5,
                            fontWeight: "800",
                          }}
                          numberOfLines={1}
                        >
                          {kindLabel(order.kind, ts)}
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
                          {ts("client.home.labels.pickup", "Pickup")}:{" "}
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
                          {ts("client.home.labels.dropoff", "Dropoff")}:{" "}
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

                          {order.payment_status ? (
                            <Text
                              style={{
                                color:
                                  order.payment_status === "paid"
                                    ? "#86EFAC"
                                    : order.payment_status === "processing"
                                    ? "#FDE68A"
                                    : "#CBD5E1",
                                fontSize: 12,
                                fontWeight: "800",
                              }}
                            >
                              💳 {order.payment_status}
                            </Text>
                          ) : null}
                        </View>
                      </View>

                      <View style={{ alignItems: "flex-end" }}>
                        {isRestaurant ? (
                          <Pressable
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
                          </Pressable>
                        ) : (
                          <View
                            style={{
                              paddingHorizontal: 10,
                              paddingVertical: 8,
                              borderRadius: 999,
                              backgroundColor: "rgba(59,130,246,0.10)",
                              borderWidth: 1,
                              borderColor: "rgba(96,165,250,0.18)",
                            }}
                          >
                            <Text
                              style={{
                                color: "#93C5FD",
                                fontSize: 11,
                                fontWeight: "900",
                              }}
                            >
                              LIVE
                            </Text>
                          </View>
                        )}

                        <View
                          style={{
                            marginTop: 12,
                            paddingHorizontal: 12,
                            paddingVertical: 7,
                            borderRadius: 999,
                            backgroundColor: pill.bg,
                            borderWidth: 1,
                            borderColor: pill.border,
                            maxWidth: 170,
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
                            {orderStatusLabelForCard(order, ts)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}

            {items.length > HOME_RECENT_LIMIT && (
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