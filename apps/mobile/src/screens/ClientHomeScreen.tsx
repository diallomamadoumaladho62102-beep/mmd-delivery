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
  Platform,
  StyleSheet,
  Alert,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";
import { clearSelectedRole } from "../lib/authRole";
import { useTranslation } from "react-i18next";
import { setLocaleForRoleAndApply } from "../i18n";
import { useClientPlatformFeatures } from "../hooks/useClientPlatformFeatures";

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
  kind?: unknown;
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
const CLIENT_BOTTOM_SAFE_PADDING = Platform.OS === "android" ? 96 : 54;
const CARD_SHADOW = {
  shadowColor: "#000",
  shadowOpacity: 0.22,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 10 },
  elevation: 6,
} as const;

const PREMIUM_BG = "#030712";
const PREMIUM_SURFACE = "#07111F";
const PREMIUM_CARD_BG = "rgba(15,23,42,0.82)";
const PREMIUM_BORDER = "rgba(148,163,184,0.16)";
const PURPLE = "#A855F7";
const GREEN = "#22C55E";
const BLUE = "#3B82F6";
const YELLOW = "#FACC15";
const RED = "#EF4444";

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
  if (kind === "delivery_request") return "🚗";
  return "🍔";
}

function kindLabel(
  kind: ItemKind,
  ts: (key: string, fallback: string, params?: Record<string, unknown>) => string
) {
  if (kind === "delivery_request") {
    return ts("client.home.kind.delivery_request", "Delivery request");
  }

  return ts("client.home.kind.restaurant_order", "Restaurant order");
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
    if (item.status === "dispatched") {
      return `🚙 ${ts("orders.status.dispatched", "On the way")}`;
    }
    if (item.status === "delivered") {
      return `✅ ${ts("orders.status.delivered", "Delivered")}`;
    }
    if (item.status === "canceled") {
      return `⛔ ${ts("orders.status.canceled", "Canceled")}`;
    }
    return `⏳ ${ts("orders.status.pending", "Pending")}`;
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

function formatCompactDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  return `${d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  })} • ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function recentOrderTitle(item: ClientItem) {
  if (item.kind === "delivery_request") return "Send Package";
  const pickup = item.pickup_address?.split(",")[0]?.trim();
  return pickup || "Restaurant Order";
}

function activityIcon(item: ClientItem) {
  if (item.kind === "delivery_request") return "📦";
  if (item.status === "delivered") return "🍔";
  if (item.status === "dispatched") return "🍕";
  return "🍽️";
}

function statusAccentColor(status: OrderStatus) {
  if (status === "delivered") return GREEN;
  if (status === "canceled") return RED;
  if (status === "dispatched") return PURPLE;
  if (status === "pending") return YELLOW;
  return BLUE;
}

function premiumStatusText(
  item: ClientItem,
  ts: (key: string, fallback: string, params?: Record<string, unknown>) => string
) {
  if (item.status === "delivered") return ts("orders.status.delivered", "Delivered");
  if (item.status === "canceled") return ts("orders.status.canceled", "Canceled");
  if (item.status === "dispatched") return ts("orders.status.dispatched", "On the way");
  if (item.kind === "delivery_request" && item.status === "pending") {
    return ts("delivery_requests.status.paid_pending", "Finding driver");
  }
  return orderStatusLabelForCard(item, ts).replace(/^\S+\s/, "");
}

function averageRatingEstimate(delivered: number, canceled: number) {
  if (delivered <= 0) return "—";
  const rating = Math.max(4.2, Math.min(5, 4.9 - canceled * 0.08));
  return rating.toFixed(1);
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

    const rawKind = typeof row.kind === "string" ? row.kind.trim().toLowerCase() : "";

    // ✅ IMPORTANT:
    // On ne montre plus pickup_dropoff dans la home client.
    // Le flux client officiel "delivery request" doit rester uniquement celui avec la voiture.
    // Le flux carton sera gardé pour un autre usage plus tard (taxi / autre module).
    if (rawKind === "pickup_dropoff") {
      continue;
    }

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

function dedupeClientItems(items: ClientItem[]) {
  const map = new Map<string, ClientItem>();

  for (const item of items) {
    const key = item.id;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, item);
      continue;
    }

    // On préfère delivery_request si jamais il y a conflit d'id
    if (existing.kind !== "delivery_request" && item.kind === "delivery_request") {
      map.set(key, item);
      continue;
    }

    const existingTime = existing.updated_at
      ? new Date(existing.updated_at).getTime()
      : existing.created_at
      ? new Date(existing.created_at).getTime()
      : 0;

    const incomingTime = item.updated_at
      ? new Date(item.updated_at).getTime()
      : item.created_at
      ? new Date(item.created_at).getTime()
      : 0;

    if (incomingTime > existingTime) {
      map.set(key, item);
    }
  }

  return Array.from(map.values());
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
        numberOfLines={1}
        ellipsizeMode="tail"
        style={{
          color: "white",
          fontSize: 17,
          fontWeight: "900",
          flex: 1,
          paddingRight: 10,
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
  disabled = false,
  comingSoonLabel,
}: {
  title: string;
  subtitle: string;
  emoji: string;
  tileEmoji: string;
  backgroundColor: string;
  borderColor: string;
  onPress: () => void;
  disabled?: boolean;
  comingSoonLabel?: string;
}) {
  return (
    <TouchableOpacity
      activeOpacity={disabled ? 1 : 0.9}
      onPress={disabled ? undefined : onPress}
      style={[
        premiumStyles.quickActionCard,
        {
          backgroundColor,
          borderColor,
          opacity: disabled ? 0.55 : 1,
        },
      ]}
    >
      <View style={premiumStyles.quickActionGlow} />
      <View style={premiumStyles.quickActionIconBox}>
        <Text style={premiumStyles.quickActionTileIcon}>{tileEmoji}</Text>
      </View>

      <View style={premiumStyles.quickActionTextWrap}>
        <Text numberOfLines={1} ellipsizeMode="tail" style={premiumStyles.quickActionTitle}>
          {title}
        </Text>
        <Text numberOfLines={3} ellipsizeMode="tail" style={premiumStyles.quickActionSubtitle}>
          {comingSoonLabel ?? subtitle}
        </Text>
      </View>

      <Text style={premiumStyles.quickActionArrow}>›</Text>
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
        borderRadius: 22,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: bg,
        padding: 14,
        minHeight: 108,
        justifyContent: "space-between",
        overflow: "hidden",
      }}
    >
      <Text style={{ fontSize: 22 }}>{icon}</Text>
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        style={{ color: "#D1D5DB", fontSize: 12, fontWeight: "700" }}
      >
        {label}
      </Text>
      <Text
        numberOfLines={1}
        style={{ color: "white", fontSize: 22, fontWeight: "900" }}
      >
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
        ...CARD_SHADOW,
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
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{
              color: "white",
              fontSize: 18,
              fontWeight: "900",
            }}
          >
            {title}
          </Text>
          <Text
            numberOfLines={2}
            ellipsizeMode="tail"
            style={{
              color: "#CBD5E1",
              fontSize: 13,
              marginTop: 4,
              lineHeight: 18,
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
              maxWidth: 72,
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
        numberOfLines={1}
        ellipsizeMode="tail"
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


function ActivityStatItem({
  icon,
  value,
  label,
  accent,
}: {
  icon: string;
  value: string | number;
  label: string;
  accent: string;
}) {
  return (
    <View style={premiumStyles.activityStatItem}>
      <View style={[premiumStyles.activityIconBox, { backgroundColor: `${accent}24`, borderColor: `${accent}45` }]}>
        <Text style={premiumStyles.activityIcon}>{icon}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={premiumStyles.activityValue}>
          {value}
        </Text>
        <Text numberOfLines={2} ellipsizeMode="tail" style={premiumStyles.activityLabel}>
          {label}
        </Text>
      </View>
    </View>
  );
}

function PremiumRecentRow({
  item,
  onPress,
  onChatPress,
  ts,
}: {
  item: ClientItem;
  onPress: () => void;
  onChatPress?: () => void;
  ts: (key: string, fallback: string, params?: Record<string, unknown>) => string;
}) {
  const accent = statusAccentColor(item.status);
  const isRestaurant = item.kind === "restaurant_order";
  const title = recentOrderTitle(item);
  const statusText = premiumStatusText(item, ts);
  const amount = formatCurrency(item.total ?? item.delivery_fee);

  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={premiumStyles.recentRow}>
      <View style={[premiumStyles.recentAccent, { backgroundColor: accent }]} />

      <View style={[premiumStyles.recentIconBox, { borderColor: `${accent}60`, backgroundColor: `${accent}22` }]}>
        <Text style={premiumStyles.recentIcon}>{activityIcon(item)}</Text>
      </View>

      <View style={premiumStyles.recentContent}>
        <Text numberOfLines={1} ellipsizeMode="tail" style={premiumStyles.recentTitle}>
          {title}
        </Text>
        <Text numberOfLines={1} ellipsizeMode="tail" style={premiumStyles.recentMeta}>
          {formatCompactDateTime(item.created_at)}
        </Text>
        <Text numberOfLines={1} ellipsizeMode="tail" style={premiumStyles.recentSub}>
          {isRestaurant ? "🍕" : "🚗"} {kindLabel(item.kind, ts)} • #{item.id.slice(0, 8)}
        </Text>
      </View>

      <View style={premiumStyles.recentRight}>
        {isRestaurant && onChatPress ? (
          <Pressable
            onPress={(event) => {
              event.stopPropagation();
              onChatPress();
            }}
            style={premiumStyles.chatMiniButton}
          >
            <Text style={premiumStyles.chatMiniText}>💬</Text>
          </Pressable>
        ) : null}

        <View style={[premiumStyles.statusChip, { backgroundColor: `${accent}22` }]}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={[premiumStyles.statusChipText, { color: accent }]}>
            {statusText}
          </Text>
        </View>

        <Text numberOfLines={1} style={premiumStyles.recentAmount}>
          {amount}
        </Text>
      </View>

      <Text style={premiumStyles.recentChevron}>›</Text>
    </TouchableOpacity>
  );
}

function BottomNavItem({
  icon,
  label,
  active,
  onPress,
}: {
  icon: string;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity activeOpacity={0.86} onPress={onPress} style={premiumStyles.bottomNavItem}>
      <Text style={[premiumStyles.bottomNavIcon, active && { color: PURPLE }]}>{icon}</Text>
      <Text numberOfLines={1} style={[premiumStyles.bottomNavLabel, active && { color: "#C084FC" }]}>
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
  const { features: platformFeatures, refresh: refreshPlatformFeatures } =
    useClientPlatformFeatures();

  const comingSoonLabel = ts(
    "client.home.comingSoonInArea",
    "Coming soon in your area"
  );

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
      void refreshPlatformFeatures();
      return () => {
        setMenuOpen(false);
      };
    }, [refreshPlatformFeatures])
  );

  const fetchAllForUser = useCallback(async (userId: string) => {
    const [ordersRes, requestsClientRes, requestsCreatedRes] = await Promise.all([
      supabase
        .from("orders")
        .select(
          `
            id,
            kind,
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
        .eq("created_by", userId)
        .order("created_at", { ascending: false })
        .limit(FETCH_LIMIT),
    ]);

    if (ordersRes.error) {
      console.log("❌ orders error:", ordersRes.error);
      throw ordersRes.error;
    }

    if (requestsClientRes.error) {
      console.log(
        "❌ delivery_requests client_user_id error:",
        requestsClientRes.error
      );
    }

    if (requestsCreatedRes.error) {
      console.log(
        "❌ delivery_requests created_by error:",
        requestsCreatedRes.error
      );
    }

    const normalizedOrders = normalizeOrderRows(
      (ordersRes.data as OrderRowDb[] | null) ?? []
    );

    const normalizedRequests = normalizeDeliveryRequestRows([
      ...((requestsClientRes.data as DeliveryRequestRowDb[] | null) ?? []),
      ...((requestsCreatedRes.data as DeliveryRequestRowDb[] | null) ?? []),
    ]);

    const merged = dedupeClientItems([
      ...normalizedOrders,
      ...normalizedRequests,
    ]);

    return sortClientItems(merged);
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

      await clearSelectedRole();

      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
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

  const totalSpent = useMemo(() => {
    return items.reduce((sum, item) => {
      const amount = item.total ?? item.delivery_fee ?? 0;
      return sum + (Number.isFinite(amount) ? Number(amount) : 0);
    }, 0);
  }, [items]);

  const averageRating = useMemo(
    () => averageRatingEstimate(stats.delivered, stats.canceled),
    [stats.delivered, stats.canceled]
  );

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
    <SafeAreaView style={premiumStyles.safe}>
      <StatusBar barStyle="light-content" />

      <Pressable
        style={premiumStyles.root}
        onPress={() => {
          if (menuOpen) setMenuOpen(false);
        }}
      >
        <ScrollView
          style={premiumStyles.scroll}
          contentContainerStyle={premiumStyles.scrollContent}
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
          <View style={premiumStyles.shell}>
            <View pointerEvents="none" style={premiumStyles.bgGlowOne} />
            <View pointerEvents="none" style={premiumStyles.bgGlowTwo} />

            <View style={premiumStyles.header}>
              <View style={premiumStyles.headerLeft}>
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={premiumStyles.avatarImage} />
                ) : (
                  <View style={premiumStyles.avatarFallback}>
                    <Text style={premiumStyles.avatarInitials}>{initials}</Text>
                  </View>
                )}

                <View style={premiumStyles.headerText}>
                  <Text numberOfLines={1} style={premiumStyles.helloText}>
                    Hello, <Text style={premiumStyles.helloStrong}>{truncateName(firstName)}</Text>
                  </Text>

                  <Text numberOfLines={1} ellipsizeMode="tail" style={premiumStyles.greetingTitle}>
                    {greeting}! 👋
                  </Text>

                  <Text numberOfLines={1} ellipsizeMode="tail" style={premiumStyles.greetingSubtitle}>
                    {ts("client.home.header.question", "What would you like to do today?")}
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={(event) => {
                  event.stopPropagation();
                }}
                style={premiumStyles.headerRight}
              >
                <View style={premiumStyles.langRow}>
                  {(["en", "fr", "es"] as const).map((lang) => {
                    const active = currentLang === lang;
                    return (
                      <TouchableOpacity
                        key={lang}
                        activeOpacity={0.9}
                        onPress={() => {
                          void changeLang(lang);
                        }}
                        style={[premiumStyles.langButton, active && premiumStyles.langButtonActive]}
                      >
                        <Text style={[premiumStyles.langText, active && premiumStyles.langTextActive]}>
                          {lang}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => setMenuOpen((prev) => !prev)}
                  style={premiumStyles.bellButton}
                >
                  <Text style={premiumStyles.bellIcon}>🔔</Text>
                  {stats.inProgress > 0 ? (
                    <View style={premiumStyles.bellBadge}>
                      <Text style={premiumStyles.bellBadgeText}>{Math.min(99, stats.inProgress)}</Text>
                    </View>
                  ) : null}
                </TouchableOpacity>

                {menuOpen ? (
                  <View style={premiumStyles.menu}>
                    <Text style={premiumStyles.menuTitle}>Account</Text>
                    <MenuAction label="Switch role" onPress={handleGoToRoleSelect} />
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
              <View style={premiumStyles.errorBox}>
                <Text numberOfLines={3} style={premiumStyles.errorText}>
                  {ts(error.key, error.fallback, error.params)}
                </Text>
              </View>
            ) : null}

            {platformFeatures.maintenance_mode ? (
              <View style={premiumStyles.errorBox}>
                <Text style={premiumStyles.errorText}>
                  {platformFeatures.message ??
                    ts(
                      "client.home.maintenanceBanner",
                      "MMD is under maintenance in your area. New orders are temporarily disabled."
                    )}
                </Text>
              </View>
            ) : null}

            <View style={premiumStyles.quickGrid}>
              <ActionBanner
                title={ts("client.home.banner.restaurant.title", "Order Food")}
                subtitle={ts(
                  "client.home.banner.restaurant.subtitle",
                  "Discover restaurants and order your favorite meals"
                )}
                emoji="🍔"
                tileEmoji="🍔"
                backgroundColor="rgba(5,150,105,0.74)"
                borderColor="rgba(52,211,153,0.28)"
                disabled={!platformFeatures.restaurant_available}
                comingSoonLabel={
                  !platformFeatures.restaurant_available ? comingSoonLabel : undefined
                }
                onPress={() => navigation.navigate("ClientRestaurantList" as never)}
              />

              <ActionBanner
                title={ts("client.home.banner.delivery.title", "Send Package")}
                subtitle={ts(
                  "client.home.banner.delivery.subtitle",
                  "Send anything anywhere quickly & safely"
                )}
                emoji="🚗"
                tileEmoji="🚙"
                backgroundColor="rgba(79,70,229,0.82)"
                borderColor="rgba(167,139,250,0.32)"
                disabled={!platformFeatures.delivery_available}
                comingSoonLabel={
                  !platformFeatures.delivery_available ? comingSoonLabel : undefined
                }
                onPress={() => navigation.navigate("DeliveryRequest" as never)}
              />

              <ActionBanner
                title={ts("client.home.banner.taxi.title", "Book a Taxi")}
                subtitle={ts(
                  "client.home.banner.taxi.subtitle",
                  "Ride with MMD Taxi — separate from delivery"
                )}
                emoji="🚕"
                tileEmoji="🚕"
                backgroundColor="rgba(180,83,9,0.82)"
                borderColor="rgba(251,191,36,0.32)"
                disabled={!platformFeatures.taxi_available}
                comingSoonLabel={!platformFeatures.taxi_available ? comingSoonLabel : undefined}
                onPress={() => navigation.navigate("TaxiHome" as never)}
              />

              <ActionBanner
                title={ts("client.home.banner.marketplace.title", "Marketplace")}
                subtitle={ts(
                  "client.home.banner.marketplace.subtitle",
                  "Shop local sellers — coming to MMD"
                )}
                emoji="🛍️"
                tileEmoji="🛍️"
                backgroundColor="rgba(124,58,237,0.82)"
                borderColor="rgba(196,181,253,0.32)"
                disabled={!platformFeatures.marketplace_available}
                comingSoonLabel={
                  !platformFeatures.marketplace_available ? comingSoonLabel : undefined
                }
                onPress={() => {
                  if (platformFeatures.marketplace_available) {
                    navigation.navigate("MarketplaceHome" as never);
                    return;
                  }
                  Alert.alert(
                    ts("client.home.banner.marketplace.title", "Marketplace"),
                    comingSoonLabel
                  );
                }}
              />
            </View>

            <View style={premiumStyles.activityCard}>
              <Text style={premiumStyles.cardTitle}>{ts("client.home.activity.title", "Your Activity")}</Text>

              <View style={premiumStyles.activityGrid}>
                <ActivityStatItem
                  icon="🛍️"
                  value={stats.delivered}
                  label={ts("client.home.stats.completed", "Orders Completed")}
                  accent={GREEN}
                />
                <ActivityStatItem
                  icon="🕘"
                  value={stats.inProgress}
                  label={ts("client.home.stats.in_progress", "In Progress")}
                  accent={YELLOW}
                />
                <ActivityStatItem
                  icon="💳"
                  value={formatCurrency(totalSpent)}
                  label={ts("client.home.stats.total_spent", "Total Spent")}
                  accent={BLUE}
                />
                <ActivityStatItem
                  icon="⭐"
                  value={averageRating}
                  label={ts("client.home.stats.average_rating", "Average Rating")}
                  accent={PURPLE}
                />
              </View>

              <View style={premiumStyles.progressBlock}>
                <View style={premiumStyles.progressHeader}>
                  <Text numberOfLines={1} style={premiumStyles.progressTitle}>
                    {ts("client.home.rewards.title", "Rewards progress")} • {stats.level}
                  </Text>
                  <Text style={premiumStyles.progressPoints}>{stats.points} pts</Text>
                </View>
                <View style={premiumStyles.progressTrack}>
                  <View style={[premiumStyles.progressFill, { width: progressBarWidth }]} />
                </View>
              </View>
            </View>

            <View style={premiumStyles.recentCard}>
              <View style={premiumStyles.recentHeader}>
                <Text style={premiumStyles.cardTitle}>{ts("client.home.section.recent", "Recent Activity")}</Text>
                {loading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <TouchableOpacity activeOpacity={0.8} onPress={handleOpenFeaturedOrder} style={premiumStyles.viewAllButton}>
                    <Text style={premiumStyles.viewAllText}>View all</Text>
                    <Text style={premiumStyles.viewAllChevron}>›</Text>
                  </TouchableOpacity>
                )}
              </View>

              {items.length === 0 && !loading ? (
                <View style={premiumStyles.emptyBox}>
                  <Text style={premiumStyles.emptyIcon}>📭</Text>
                  <Text style={premiumStyles.emptyTitle}>
                    {ts("client.home.empty.title", "Nothing here yet")}
                  </Text>
                  <Text style={premiumStyles.emptySub}>
                    {ts(
                      "client.home.empty.subtitle",
                      "Create a delivery request or order from a restaurant to test the system."
                    )}
                  </Text>
                </View>
              ) : (
                recentOrders.slice(0, 4).map((order) => {
                  const isRestaurant = order.kind === "restaurant_order";

                  return (
                    <PremiumRecentRow
                      key={`${order.kind}-${order.id}`}
                      item={order}
                      ts={ts}
                      onChatPress={
                        isRestaurant
                          ? () => {
                              handleOpenChat(order.id);
                            }
                          : undefined
                      }
                      onPress={() => {
                        if (isRestaurant) {
                          handleOpenRestaurantOrder(order.id);
                        } else {
                          (navigation as any).navigate("ClientDeliveryRequestDetails", {
                            requestId: order.id,
                          });
                        }
                      }}
                    />
                  );
                })
              )}
            </View>

            <View style={{ height: 98 }} />
          </View>
        </ScrollView>

        <View style={premiumStyles.bottomNav}>
          <BottomNavItem icon="⌂" label="Home" active onPress={() => {}} />
          <BottomNavItem icon="▢" label="Orders" onPress={handleOpenFeaturedOrder} />
          <BottomNavItem
            icon="➤"
            label="Send"
            onPress={() => navigation.navigate("DeliveryRequest" as never)}
          />
          <BottomNavItem
            icon="▣"
            label="Food"
            onPress={() => navigation.navigate("ClientRestaurantList" as never)}
          />
          <BottomNavItem
            icon="◎"
            label="Account"
            onPress={() => setMenuOpen((prev) => !prev)}
          />
        </View>
      </Pressable>
    </SafeAreaView>
  );
}


const premiumStyles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: PREMIUM_BG,
  },
  root: {
    flex: 1,
    backgroundColor: PREMIUM_BG,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: CLIENT_BOTTOM_SAFE_PADDING,
  },
  shell: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 34,
    borderWidth: 1,
    borderColor: PREMIUM_BORDER,
    backgroundColor: PREMIUM_BG,
    padding: 18,
    minHeight: "100%",
    ...CARD_SHADOW,
  },
  bgGlowOne: {
    position: "absolute",
    top: -120,
    left: -100,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(37,99,235,0.20)",
  },
  bgGlowTwo: {
    position: "absolute",
    top: 150,
    right: -130,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: "rgba(168,85,247,0.14)",
  },
  header: {
    zIndex: 20,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  headerLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
    paddingRight: 12,
  },
  avatarImage: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1.5,
    borderColor: "rgba(34,197,94,0.75)",
    backgroundColor: DEFAULT_AVATAR_BG,
  },
  avatarFallback: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1.5,
    borderColor: "rgba(34,197,94,0.75)",
    backgroundColor: "rgba(15,23,42,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: {
    color: "#E5E7EB",
    fontSize: 20,
    fontWeight: "900",
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    marginLeft: 18,
  },
  helloText: {
    color: "#E5E7EB",
    fontSize: 19,
    fontWeight: "500",
  },
  helloStrong: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  greetingTitle: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "900",
    marginTop: 4,
    letterSpacing: -0.6,
  },
  greetingSubtitle: {
    color: "#CBD5E1",
    fontSize: 17,
    marginTop: 8,
  },
  headerRight: {
    alignItems: "flex-end",
    zIndex: 80,
  },
  langRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 10,
  },
  langButton: {
    minWidth: 34,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
  },
  langButtonActive: {
    backgroundColor: "rgba(168,85,247,0.22)",
    borderColor: "rgba(192,132,252,0.38)",
  },
  langText: {
    color: "#94A3B8",
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  langTextActive: {
    color: "#E9D5FF",
  },
  bellButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  bellIcon: {
    fontSize: 22,
  },
  bellBadge: {
    position: "absolute",
    top: -7,
    right: -5,
    minWidth: 23,
    height: 23,
    borderRadius: 12,
    paddingHorizontal: 5,
    backgroundColor: RED,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: PREMIUM_BG,
  },
  bellBadgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "900",
  },
  menu: {
    position: "absolute",
    top: 58,
    right: 0,
    width: 178,
    borderRadius: 18,
    padding: 10,
    backgroundColor: "#0B1220",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    zIndex: 100,
    ...CARD_SHADOW,
  },
  menuTitle: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  errorBox: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.22)",
    backgroundColor: "rgba(127,29,29,0.30)",
    padding: 14,
    marginBottom: 16,
  },
  errorText: {
    color: "#FCA5A5",
    fontWeight: "800",
  },
  quickGrid: {
    flexDirection: "row",
    gap: 14,
    marginBottom: 18,
  },
  quickActionCard: {
    flex: 1,
    minHeight: 166,
    borderRadius: 28,
    borderWidth: 1,
    padding: 16,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    ...CARD_SHADOW,
  },
  quickActionGlow: {
    position: "absolute",
    right: -34,
    top: -34,
    width: 148,
    height: 148,
    borderRadius: 74,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  quickActionIconBox: {
    width: 82,
    height: 82,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.13)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 18,
  },
  quickActionTileIcon: {
    fontSize: 38,
  },
  quickActionTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  quickActionTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
  },
  quickActionSubtitle: {
    color: "#E5E7EB",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
  },
  quickActionArrow: {
    color: "#FFFFFF",
    fontSize: 44,
    fontWeight: "300",
    marginLeft: 8,
  },
  activityCard: {
    borderRadius: 26,
    borderWidth: 1,
    borderColor: PREMIUM_BORDER,
    backgroundColor: PREMIUM_CARD_BG,
    padding: 18,
    marginBottom: 18,
  },
  cardTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 16,
  },
  activityGrid: {
    flexDirection: "row",
    gap: 12,
  },
  activityStatItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
    borderRightWidth: 1,
    borderRightColor: "rgba(148,163,184,0.12)",
    paddingRight: 8,
  },
  activityIconBox: {
    width: 54,
    height: 54,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  activityIcon: {
    fontSize: 24,
  },
  activityValue: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },
  activityLabel: {
    color: "#CBD5E1",
    fontSize: 12,
    lineHeight: 16,
    marginTop: 3,
  },
  progressBlock: {
    marginTop: 18,
  },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressTitle: {
    color: "#CBD5E1",
    fontSize: 12,
    fontWeight: "800",
    flex: 1,
    paddingRight: 10,
  },
  progressPoints: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
  },
  progressTrack: {
    height: 9,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.08)",
    marginTop: 10,
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: PURPLE,
  },
  recentCard: {
    borderRadius: 26,
    borderWidth: 1,
    borderColor: PREMIUM_BORDER,
    backgroundColor: PREMIUM_CARD_BG,
    overflow: "hidden",
    marginBottom: 18,
  },
  recentHeader: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  viewAllButton: {
    flexDirection: "row",
    alignItems: "center",
  },
  viewAllText: {
    color: "#C084FC",
    fontSize: 14,
    fontWeight: "900",
  },
  viewAllChevron: {
    color: "#C084FC",
    fontSize: 28,
    fontWeight: "300",
    marginLeft: 8,
    marginTop: -2,
  },
  recentRow: {
    minHeight: 112,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderTopWidth: 1,
    borderTopColor: "rgba(148,163,184,0.12)",
  },
  recentAccent: {
    width: 3,
    height: 70,
    borderRadius: 999,
    marginRight: 12,
  },
  recentIconBox: {
    width: 64,
    height: 64,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  recentIcon: {
    fontSize: 30,
  },
  recentContent: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  },
  recentTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
  },
  recentMeta: {
    color: "#CBD5E1",
    fontSize: 13,
    marginTop: 5,
  },
  recentSub: {
    color: "#CBD5E1",
    fontSize: 12,
    marginTop: 7,
  },
  recentRight: {
    alignItems: "flex-end",
    width: 126,
  },
  chatMiniButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  chatMiniText: {
    fontSize: 15,
  },
  statusChip: {
    maxWidth: 118,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
    marginBottom: 8,
  },
  statusChipText: {
    fontSize: 12,
    fontWeight: "900",
  },
  recentAmount: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  recentChevron: {
    color: "#CBD5E1",
    fontSize: 30,
    fontWeight: "300",
    marginLeft: 10,
  },
  emptyBox: {
    padding: 24,
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "rgba(148,163,184,0.12)",
  },
  emptyIcon: {
    fontSize: 34,
    marginBottom: 8,
  },
  emptyTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
  },
  emptySub: {
    color: "#94A3B8",
    fontSize: 13,
    marginTop: 6,
    textAlign: "center",
    lineHeight: 19,
  },
  bottomNav: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: Platform.OS === "android" ? 18 : 22,
    minHeight: 76,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: PREMIUM_BORDER,
    backgroundColor: "rgba(15,23,42,0.96)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 10,
    paddingVertical: 8,
    zIndex: 50,
    ...CARD_SHADOW,
  },
  bottomNavItem: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomNavIcon: {
    color: "#94A3B8",
    fontSize: 24,
    fontWeight: "900",
  },
  bottomNavLabel: {
    color: "#CBD5E1",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
  },
});

export default ClientHomeScreen;