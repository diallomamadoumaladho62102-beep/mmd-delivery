import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SafeAreaView, StatusBar, Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";
import { clearSelectedRole } from "../lib/authRole";
import { useTranslation } from "react-i18next";
import { setLocaleForRoleAndApply } from "../i18n";
import type { AppLanguageCode } from "../i18n/languageOptions";
import i18n from "../i18n";
import { formatMoney as formatMoneyLocale } from "../i18n/formatters";
import { resolveMarketScopeFromFeatures } from "../lib/marketScope";
import { useClientPlatformFeatures } from "../hooks/useClientPlatformFeatures";
import { ClientHomeV4View } from "../components/client/home/ClientHomeV4View";
import { v4Styles } from "../components/client/home/clientHomeTheme";

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
const DEFAULT_CLIENT_NAME = "Client";

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
  return formatMoneyLocale(amount, "USD", i18n.language);
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
  const [recentActivityUnavailable, setRecentActivityUnavailable] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>("");
  const [menuOpen, setMenuOpen] = useState(false);
  const { features: platformFeatures, refresh: refreshPlatformFeatures, refreshWithCurrentLocation } =
    useClientPlatformFeatures();

  const market = useMemo(
    () => resolveMarketScopeFromFeatures(platformFeatures),
    [platformFeatures]
  );

  const scopeLabel = market.scopeResolved
    ? market.displayLabel
    : platformFeatures.scope_label ??
      platformFeatures.scope?.scope_label ??
      null;

  const scopeSource = platformFeatures.scope_source ?? platformFeatures.scope?.scope_source ?? null;

  const scopeSourceLabel = useMemo(() => {
    switch (scopeSource) {
      case "gps":
        return ts("client.home.scope.source.gps", "GPS");
      case "order_pickup":
        return ts("client.home.scope.source.order", "Order address");
      case "saved_address":
        return ts("client.home.scope.source.savedAddress", "Saved address");
      case "profile":
        return ts("client.home.scope.source.profile", "Profile");
      case "manual":
        return ts("client.home.scope.source.manual", "Manual selection");
      case "country_fallback":
        return ts("client.home.scope.source.fallback", "Default");
      default:
        return scopeSource ?? ts("client.home.scope.source.unknown", "Unknown");
    }
  }, [scopeSource, ts]);

  const showUseCurrentLocation =
    scopeSource === "saved_address" ||
    scopeSource === "profile" ||
    scopeSource === "country_fallback" ||
    scopeSource === "manual";

  const comingSoonLabel = ts("client.home.v4.comingSoon", "Launching soon");
  const marketplaceSoonLabel = ts(
    "client.home.v4.service.marketplace.soon",
    "Discover local stores"
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
        .or(
          `client_user_id.eq.${userId},client_id.eq.${userId},created_by.eq.${userId},user_id.eq.${userId}`
        )
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
      ordersRes.error
        ? []
        : ((ordersRes.data as OrderRowDb[] | null) ?? [])
    );

    const normalizedRequests = normalizeDeliveryRequestRows([
      ...((requestsClientRes.data as DeliveryRequestRowDb[] | null) ?? []),
      ...((requestsCreatedRes.data as DeliveryRequestRowDb[] | null) ?? []),
    ]);

    const merged = dedupeClientItems([
      ...normalizedOrders,
      ...normalizedRequests,
    ]);

    const hadFetchIssue = !!(
      ordersRes.error ||
      requestsClientRes.error ||
      requestsCreatedRes.error
    );

    return { items: sortClientItems(merged), hadFetchIssue };
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
        if (isMountedRef.current) {
          setError(null);
          setRecentActivityUnavailable(false);
        }

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

        const { items: mergedItems, hadFetchIssue } = await fetchAllForUser(user.id);

        if (!isMountedRef.current) return;

        setDisplayName(String(fullName));
        setAvatarUrl(isValidImageUri(nextAvatar) ? nextAvatar : null);
        setItems(mergedItems);
        setRecentActivityUnavailable(hadFetchIssue && mergedItems.length === 0);

        subscribeRealtime(user.id);
      } catch (e: unknown) {
        if (!isMountedRef.current) return;

        console.log("client home fetch error:", e);
        setRecentActivityUnavailable(true);
        setError(null);
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
    async (lang: AppLanguageCode) => {
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

  const handleOpenFeaturedOrder = useCallback(() => {
    const target = activeOrder ?? lastDeliveredOrder ?? items[0];
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
  }, [activeOrder, items, lastDeliveredOrder, navigation]);

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

  const spendingAmount = totalSpent > 0 ? formatCurrency(totalSpent) : null;

  const handleNavigateMarketplace = useCallback(() => {
    if (platformFeatures.marketplace_available) {
      navigation.navigate("MarketplaceHome" as never);
      return;
    }
    Alert.alert(
      ts("client.home.banner.marketplace.title", "Marketplace"),
      comingSoonLabel
    );
  }, [comingSoonLabel, navigation, platformFeatures.marketplace_available, ts]);

  const handleOpenOrderItem = useCallback(
    (item: ClientItem) => {
      if (item.kind === "restaurant_order") {
        handleOpenRestaurantOrder(item.id);
        return;
      }
      (navigation as any).navigate("ClientDeliveryRequestDetails", {
        requestId: item.id,
      });
    },
    [handleOpenRestaurantOrder, navigation]
  );

  return (
    <SafeAreaView style={v4Styles.safe}>
      <StatusBar barStyle="light-content" />
      <SafeAreaProvider>
        <ClientHomeV4View
        ts={ts}
        loading={loading}
        refreshing={refreshing}
        items={items}
        error={error}
        recentActivityUnavailable={recentActivityUnavailable}
        avatarUrl={avatarUrl}
        initials={initials}
        firstName={firstName}
        greeting={greeting}
        displayLocation=""
        spendingAmount={spendingAmount}
        activeOrdersCount={stats.inProgress}
        platformFeatures={platformFeatures}
        comingSoonLabel={comingSoonLabel}
        marketplaceSoonLabel={marketplaceSoonLabel}
        scopeLabel={scopeLabel}
        showUseCurrentLocation={showUseCurrentLocation}
        stats={stats}
        progressBarWidth={progressBarWidth}
        menuOpen={menuOpen}
        currentLang={currentLang}
        onRefresh={() => {
          void fetchOrders("refresh");
        }}
        onRefreshLocation={() => {
          void refreshWithCurrentLocation();
        }}
        onChangeLang={changeLang}
        onCloseMenu={() => setMenuOpen(false)}
        onToggleMenu={() => setMenuOpen((prev) => !prev)}
        onSignOut={() => {
          void handleSignOut();
        }}
        onSwitchRole={handleGoToRoleSelect}
        onNavigateTaxi={() => navigation.navigate("TaxiHome" as never)}
        onNavigateFood={() => navigation.navigate("ClientRestaurantList" as never)}
        onNavigateDelivery={() => navigation.navigate("DeliveryRequest" as never)}
        onNavigateMarketplace={handleNavigateMarketplace}
        onNavigateInbox={() => navigation.navigate("ClientInbox" as never)}
        onNavigateProfile={() => navigation.navigate("ClientProfile" as never)}
        onNavigateOrders={handleOpenFeaturedOrder}
        onNavigateRewards={() => navigation.navigate("TaxiLoyalty" as never)}
        onNavigateAi={() =>
          navigation.navigate("MmdAi", { source: "home_tab" })
        }
        onOpenOrder={(item) => handleOpenOrderItem(item as ClientItem)}
        onOpenChat={handleOpenChat}
        formatCurrency={formatCurrency}
        formatCompactDateTime={formatCompactDateTime}
        recentTitle={(item) => recentOrderTitle(item as ClientItem)}
        statusLabel={(item) => premiumStatusText(item as ClientItem, ts)}
        />
      </SafeAreaProvider>
    </SafeAreaView>
  );
}

export default ClientHomeScreen;
