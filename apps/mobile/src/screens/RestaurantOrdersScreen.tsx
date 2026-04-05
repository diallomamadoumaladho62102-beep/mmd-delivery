// apps/mobile/src/screens/RestaurantOrdersScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  ActivityIndicator,
  FlatList,
  TouchableOpacity,
  AppState,
  AppStateStatus,
  Alert,
} from "react-native";
import { Audio } from "expo-av";
import { supabase } from "../lib/supabase";
import { useTranslation } from "react-i18next";

const ACCEPT_WINDOW_SECONDS = 180;
const RING_REPEAT_EVERY_MS = 6000;
const RING_COOLDOWN_MS = 2500;

/**
 * Important fix:
 * We no longer hide expired pending orders.
 * Before, pending orders could disappear from the list even if they still existed in DB/dashboard.
 */
const HIDE_EXPIRED_PENDING = false;

type DbOrderStatus =
  | "pending"
  | "assigned"
  | "accepted"
  | "prepared"
  | "ready"
  | "dispatched"
  | "delivered"
  | "canceled";

type OrderStatus =
  | "pending"
  | "accepted"
  | "prepared"
  | "ready"
  | "dispatched"
  | "delivered"
  | "canceled";

type FilterKey = "all" | "pending" | "prepared" | "ready";

type OrderRow = {
  id: string;
  status: DbOrderStatus | string;
  created_at: string | null;
  currency: string | null;
  total: number | null;
  grand_total: number | null;
  total_cents: number | null;
  restaurant_accept_expires_at: string | null;
};

type Order = {
  id: string;
  status: OrderStatus;
  total: number | null;
  created_at: string | null;
  currency: string | null;
  restaurant_accept_expires_at: string | null;
};

const ACTIVE_STATUSES_UI: OrderStatus[] = [
  "pending",
  "accepted",
  "prepared",
  "ready",
  "dispatched",
];

function mapDbStatusToUiStatus(s: string): OrderStatus {
  const v = String(s || "").toLowerCase();

  if (v === "assigned") return "pending";

  if (
    v === "pending" ||
    v === "accepted" ||
    v === "prepared" ||
    v === "ready" ||
    v === "dispatched" ||
    v === "delivered" ||
    v === "canceled"
  ) {
    return v as OrderStatus;
  }

  return "pending";
}

function pickTotal(row: Partial<OrderRow>): number | null {
  const total = row?.total;
  if (typeof total === "number" && Number.isFinite(total)) return total;

  const grand = row?.grand_total;
  if (typeof grand === "number" && Number.isFinite(grand)) return grand;

  const cents = row?.total_cents;
  if (typeof cents === "number" && Number.isFinite(cents)) return cents / 100;

  return null;
}

function remainingAcceptSeconds(
  expiresAt: string | null,
  createdAt: string | null
): number {
  const now = Date.now();

  if (expiresAt) {
    const exp = new Date(expiresAt).getTime();
    if (Number.isFinite(exp)) return Math.floor((exp - now) / 1000);
  }

  if (createdAt) {
    const created = new Date(createdAt).getTime();
    if (Number.isFinite(created)) {
      const deadline = created + ACCEPT_WINDOW_SECONDS * 1000;
      return Math.floor((deadline - now) / 1000);
    }
  }

  return 0;
}

function fmtCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function formatTimeAgo(iso: string | null): string {
  if (!iso) return "—";

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  const diff = Math.floor((Date.now() - d.getTime()) / 1000);

  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function statusColors(status: OrderStatus) {
  switch (status) {
    case "pending":
      return {
        bg: "rgba(239,68,68,0.12)",
        border: "rgba(239,68,68,0.35)",
        text: "#FCA5A5",
      };
    case "accepted":
      return {
        bg: "rgba(59,130,246,0.12)",
        border: "rgba(59,130,246,0.35)",
        text: "#BFDBFE",
      };
    case "prepared":
      return {
        bg: "rgba(245,158,11,0.14)",
        border: "rgba(245,158,11,0.35)",
        text: "#FCD34D",
      };
    case "ready":
      return {
        bg: "rgba(16,185,129,0.14)",
        border: "rgba(16,185,129,0.35)",
        text: "#A7F3D0",
      };
    case "dispatched":
      return {
        bg: "rgba(168,85,247,0.14)",
        border: "rgba(168,85,247,0.35)",
        text: "#DDD6FE",
      };
    default:
      return {
        bg: "rgba(75,85,99,0.16)",
        border: "rgba(75,85,99,0.35)",
        text: "#D1D5DB",
      };
  }
}

function FilterChip({
  label,
  count,
  active,
  onPress,
  tone = "default",
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
  tone?: "default" | "danger" | "warning" | "success";
}) {
  const palette =
    tone === "danger"
      ? {
          border: active ? "#EF4444" : "#3F1A1A",
          bg: active ? "rgba(239,68,68,0.18)" : "#08112A",
          text: active ? "#FECACA" : "#E5E7EB",
          badgeBg: active ? "#EF4444" : "#1F2937",
        }
      : tone === "warning"
        ? {
            border: active ? "#F59E0B" : "#3A2A10",
            bg: active ? "rgba(245,158,11,0.18)" : "#08112A",
            text: active ? "#FDE68A" : "#E5E7EB",
            badgeBg: active ? "#D97706" : "#1F2937",
          }
        : tone === "success"
          ? {
              border: active ? "#10B981" : "#153428",
              bg: active ? "rgba(16,185,129,0.18)" : "#08112A",
              text: active ? "#A7F3D0" : "#E5E7EB",
              badgeBg: active ? "#059669" : "#1F2937",
            }
          : {
              border: active ? "#2563EB" : "#1F2937",
              bg: active ? "rgba(37,99,235,0.18)" : "#08112A",
              text: active ? "#DBEAFE" : "#E5E7EB",
              badgeBg: active ? "#2563EB" : "#1F2937",
            };

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.bg,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
      }}
    >
      <Text style={{ color: palette.text, fontWeight: "900", fontSize: 13 }}>
        {label}
      </Text>

      <View
        style={{
          minWidth: 24,
          height: 24,
          borderRadius: 12,
          paddingHorizontal: 7,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: palette.badgeBg,
        }}
      >
        <Text style={{ color: "white", fontWeight: "900", fontSize: 12 }}>
          {count}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function HeaderAction({
  label,
  onPress,
  borderColor,
  backgroundColor,
  textColor,
}: {
  label: string;
  onPress: () => void;
  borderColor: string;
  backgroundColor: string;
  textColor: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.88}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 999,
        borderWidth: 1,
        borderColor,
        backgroundColor,
      }}
    >
      <Text style={{ color: textColor, fontSize: 13, fontWeight: "900" }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export function RestaurantOrdersScreen({ navigation }: any) {
  const { t } = useTranslation();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [restaurantUserId, setRestaurantUserId] = useState<string | null>(null);
  const [resolveDone, setResolveDone] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<FilterKey>("all");

  const soundRef = useRef<Audio.Sound | null>(null);
  const lastRingAtRef = useRef(0);
  const ringingLockRef = useRef(false);
  const fetchingRef = useRef(false);
  const mountedRef = useRef(true);

  const [, forceTick] = useState(0);
  const hasPendingValidRef = useRef(false);
  const ringRepeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ordersRef = useRef<Order[]>([]);

  useEffect(() => {
    ordersRef.current = orders ?? [];
  }, [orders]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;

        const uid = data?.user?.id ?? null;
        if (!cancelled && mountedRef.current) {
          setRestaurantUserId(uid);
        }
      } catch (e) {
        console.log("resolve auth uid error:", e);
        if (!cancelled && mountedRef.current) {
          setRestaurantUserId(null);
        }
      } finally {
        if (!cancelled && mountedRef.current) {
          setResolveDone(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const ensureSoundLoaded = useCallback(async () => {
    if (soundRef.current) return;

    const { sound } = await Audio.Sound.createAsync(
      require("../../assets/sounds/new-order.wav"),
      { shouldPlay: false, volume: 1 }
    );

    soundRef.current = sound;
  }, []);

  const stopRingNow = useCallback(async () => {
    try {
      if (!soundRef.current) return;

      try {
        await soundRef.current.stopAsync();
      } catch {}

      try {
        await soundRef.current.setPositionAsync(0);
      } catch {}
    } catch {}
  }, []);

  const ringOnceSafe = useCallback(async () => {
    const now = Date.now();

    if (ringingLockRef.current) return;
    if (now - lastRingAtRef.current < RING_COOLDOWN_MS) return;

    ringingLockRef.current = true;
    lastRingAtRef.current = now;

    try {
      await ensureSoundLoaded();
      if (!soundRef.current) return;

      try {
        await soundRef.current.stopAsync();
      } catch {}

      await soundRef.current.setPositionAsync(0);
      await soundRef.current.playAsync();
    } catch {
      // ignore
    } finally {
      ringingLockRef.current = false;
    }
  }, [ensureSoundLoaded]);

  const stopRepeatRinging = useCallback(() => {
    if (ringRepeatTimerRef.current) {
      clearInterval(ringRepeatTimerRef.current);
      ringRepeatTimerRef.current = null;
    }

    void stopRingNow();
  }, [stopRingNow]);

  const startRepeatRinging = useCallback(() => {
    if (ringRepeatTimerRef.current) return;

    void ringOnceSafe();

    ringRepeatTimerRef.current = setInterval(() => {
      if (!hasPendingValidRef.current) {
        stopRepeatRinging();
        return;
      }

      void ringOnceSafe();
    }, RING_REPEAT_EVERY_MS);
  }, [ringOnceSafe, stopRepeatRinging]);

  const isPendingValid = useCallback((o: Order) => {
    if (o.status !== "pending") return false;

    const rem = remainingAcceptSeconds(
      o.restaurant_accept_expires_at,
      o.created_at
    );

    return rem > 0;
  }, []);

  const computeHasPendingValid = useCallback(
    (rows: Order[]) => {
      return (rows ?? []).some((o) => isPendingValid(o));
    },
    [isPendingValid]
  );

  const applyRingingState = useCallback(
    async (rows: Order[]) => {
      const hasPendingValid = computeHasPendingValid(rows);
      hasPendingValidRef.current = hasPendingValid;

      if (hasPendingValid) startRepeatRinging();
      else stopRepeatRinging();
    },
    [computeHasPendingValid, startRepeatRinging, stopRepeatRinging]
  );

  const fetchOrders = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!restaurantUserId) return;
      if (fetchingRef.current) return;

      fetchingRef.current = true;

      if (!opts?.silent && mountedRef.current) {
        setLoading(true);
      }

      try {
        const { data, error } = await supabase
          .from("orders")
          .select(
            "id,status,created_at,currency,total,grand_total,total_cents,restaurant_accept_expires_at"
          )
          .eq("restaurant_user_id", restaurantUserId)
          .order("created_at", { ascending: false });

        if (error) throw error;

        const mapped: Order[] = (data || []).map((row: OrderRow) => {
          const uiStatus = mapDbStatusToUiStatus(row.status);

          return {
            id: String(row.id),
            status: uiStatus,
            created_at: row.created_at ?? null,
            currency: row.currency ?? "USD",
            total: pickTotal(row),
            restaurant_accept_expires_at: row.restaurant_accept_expires_at ?? null,
          };
        });

        let active = mapped.filter((o) => ACTIVE_STATUSES_UI.includes(o.status));

        if (HIDE_EXPIRED_PENDING) {
          active = active.filter(
            (o) => !(o.status === "pending" && !isPendingValid(o))
          );
        }

        if (mountedRef.current) {
          setOrders(active);
        }

        await applyRingingState(active);
      } catch (e) {
        console.log("fetchOrders error:", e);
      } finally {
        if (!opts?.silent && mountedRef.current) {
          setLoading(false);
        }

        fetchingRef.current = false;
      }
    },
    [restaurantUserId, isPendingValid, applyRingingState]
  );

  const updateOrderStatus = useCallback(
    async (orderId: string, nextStatus: DbOrderStatus) => {
      try {
        const { data: u, error: ue } = await supabase.auth.getUser();
        if (ue) throw ue;

        const actorId = u?.user?.id ?? null;

        const { data: current, error: ce } = await supabase
          .from("orders")
          .select("status")
          .eq("id", orderId)
          .maybeSingle();

        if (ce) throw ce;

        const oldStatus = String(current?.status ?? "");
        const nowIso = new Date().toISOString();

        const { error } = await supabase
          .from("orders")
          .update({ status: nextStatus })
          .eq("id", orderId);

        if (error) throw error;

        const eventType =
          nextStatus === "accepted"
            ? "restaurant_accept"
            : nextStatus === "canceled"
              ? "restaurant_reject"
              : "restaurant_status_change";

        const { error: evErr } = await supabase.from("order_events").insert({
          order_id: orderId,
          event_type: eventType,
          old_status: oldStatus || null,
          new_status: nextStatus,
          note: null,
          actor_id: actorId,
          created_at: nowIso,
          description:
            nextStatus === "accepted"
              ? "Restaurant accepted the order"
              : nextStatus === "canceled"
                ? "Restaurant rejected the order"
                : `Restaurant changed status to ${nextStatus}`,
          triggered_by: actorId,
          triggered_role: "restaurant",
          metadata: {
            source: "RestaurantOrdersScreen",
            at: nowIso,
          },
        });

        if (evErr) {
          console.log("order_events insert error:", evErr);
        }

        void fetchOrders({ silent: true });
      } catch (e: any) {
        Alert.alert(
          t("common.errorTitle", "Error"),
          e?.message ?? t("common.error", "Something went wrong.")
        );
      }
    },
    [fetchOrders, t]
  );

  const confirmAccept = useCallback(
    (orderId: string) => {
      Alert.alert(
        t("order.actions.acceptTitle", "Accept order"),
        t("order.actions.acceptConfirm", "Do you want to accept this order?"),
        [
          { text: t("common.cancel", "Cancel"), style: "cancel" },
          {
            text: t("common.yes", "Yes"),
            style: "default",
            onPress: () => {
              void updateOrderStatus(orderId, "accepted");
            },
          },
        ]
      );
    },
    [t, updateOrderStatus]
  );

  const confirmReject = useCallback(
    (orderId: string) => {
      Alert.alert(
        t("order.actions.rejectTitle", "Reject order"),
        t("order.actions.rejectConfirm", "Do you want to reject this order?"),
        [
          { text: t("common.cancel", "Cancel"), style: "cancel" },
          {
            text: t("common.yes", "Yes"),
            style: "destructive",
            onPress: () => {
              void updateOrderStatus(orderId, "canceled");
            },
          },
        ]
      );
    },
    [t, updateOrderStatus]
  );

  const handleLogout = useCallback(() => {
    Alert.alert(
      t("auth.logoutTitle", "Log out"),
      t("auth.logoutConfirm", "Do you really want to log out?"),
      [
        { text: t("common.cancel", "Cancel"), style: "cancel" },
        {
          text: t("common.yes", "Yes"),
          style: "destructive",
          onPress: async () => {
            try {
              stopRepeatRinging();

              const { error } = await supabase.auth.signOut();
              if (error) throw error;

              if (mountedRef.current) {
                setOrders([]);
                setLoading(false);
                setRestaurantUserId(null);
                setResolveDone(true);
              }

              navigation.reset({
                index: 0,
                routes: [{ name: "RoleSelect" }],
              });
            } catch (e: any) {
              Alert.alert(
                t("common.errorTitle", "Error"),
                e?.message ?? t("auth.logoutError", "Unable to log out.")
              );
            }
          },
        },
      ]
    );
  }, [navigation, stopRepeatRinging, t]);

  useEffect(() => {
    if (!restaurantUserId) return;
    void fetchOrders();
  }, [restaurantUserId, fetchOrders]);

  useEffect(() => {
    if (!restaurantUserId) return;

    const ch = supabase
      .channel(`restaurant-orders-${restaurantUserId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `restaurant_user_id=eq.${restaurantUserId}`,
        },
        () => {
          void fetchOrders({ silent: true });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [restaurantUserId, fetchOrders]);

  useEffect(() => {
    if (!restaurantUserId) return;

    const id = setInterval(() => {
      void fetchOrders({ silent: true });
    }, 5000);

    return () => clearInterval(id);
  }, [restaurantUserId, fetchOrders]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
      if (s === "active") {
        void fetchOrders({ silent: true });
      } else {
        stopRepeatRinging();
      }
    });

    return () => sub.remove();
  }, [fetchOrders, stopRepeatRinging]);

  useEffect(() => {
    const id = setInterval(() => {
      if (!mountedRef.current) return;

      forceTick((x) => x + 1);

      const currentOrders = ordersRef.current ?? [];
      const hasValid = computeHasPendingValid(currentOrders);

      if (hasPendingValidRef.current !== hasValid) {
        hasPendingValidRef.current = hasValid;
        if (hasValid) startRepeatRinging();
        else stopRepeatRinging();
      }
    }, 1000);

    return () => clearInterval(id);
  }, [computeHasPendingValid, startRepeatRinging, stopRepeatRinging]);

  useEffect(() => {
    return () => {
      stopRepeatRinging();
      soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
    };
  }, [stopRepeatRinging]);

  const statusLabel = useCallback(
    (s: OrderStatus) => {
      switch (s) {
        case "pending":
          return t("order.status.pending", "Pending");
        case "accepted":
          return t("order.status.accepted", "Accepted");
        case "prepared":
          return t("order.status.prepared", "Preparing");
        case "ready":
          return t("order.status.readyPickup", "Ready");
        case "dispatched":
          return t("order.status.dispatched", "Dispatched");
        case "delivered":
          return t("order.status.delivered", "Delivered");
        case "canceled":
          return t("order.status.canceled", "Canceled");
        default:
          return String(s);
      }
    },
    [t]
  );

  const counts = useMemo(() => {
    const pending = orders.filter((o) => o.status === "pending").length;
    const preparing = orders.filter(
      (o) => o.status === "accepted" || o.status === "prepared"
    ).length;
    const ready = orders.filter((o) => o.status === "ready").length;
    const all = orders.length;

    return { all, pending, preparing, ready };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    if (selectedFilter === "pending") {
      return orders.filter((o) => o.status === "pending");
    }

    if (selectedFilter === "prepared") {
      return orders.filter(
        (o) => o.status === "accepted" || o.status === "prepared"
      );
    }

    if (selectedFilter === "ready") {
      return orders.filter((o) => o.status === "ready");
    }

    return orders;
  }, [orders, selectedFilter]);

  const renderItem = ({ item }: { item: Order }) => {
    const rem =
      item.status === "pending"
        ? remainingAcceptSeconds(
            item.restaurant_accept_expires_at,
            item.created_at
          )
        : 0;

    const expired = item.status === "pending" && rem <= 0;
    const currency = (item.currency ?? "USD").toUpperCase();
    const showActions = item.status === "pending" && !expired;
    const pill = statusColors(item.status);

    return (
      <TouchableOpacity
        activeOpacity={0.92}
        onPress={() =>
          navigation.navigate("RestaurantOrderDetails", { orderId: item.id })
        }
      >
        <View
          style={{
            position: "relative",
            backgroundColor: "#07101F",
            borderRadius: 20,
            padding: 16,
            marginBottom: 14,
            borderWidth: 1,
            borderColor: "#1F2937",
            shadowColor: "#000",
            shadowOpacity: 0.18,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 10 },
            elevation: 2,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              justifyContent: "space-between",
              paddingRight: 54,
            }}
          >
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text
                numberOfLines={1}
                style={{ color: "white", fontWeight: "900", fontSize: 18 }}
              >
                {t("order.card.title", {
                  defaultValue: "Order #{{id}}",
                  id: item.id.slice(0, 8),
                })}
              </Text>

              <Text style={{ color: "#64748B", marginTop: 6, fontWeight: "800" }}>
                {t("restaurant.orders.received", "Received")} •{" "}
                {formatTimeAgo(item.created_at)}
              </Text>
            </View>

            <View
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 999,
                backgroundColor: pill.bg,
                borderWidth: 1,
                borderColor: pill.border,
              }}
            >
              <Text style={{ color: pill.text, fontWeight: "900", fontSize: 12 }}>
                {statusLabel(item.status)}
              </Text>
            </View>
          </View>

          {item.status === "pending" && (
            <View
              style={{
                marginTop: 12,
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: 14,
                borderWidth: 2,
                borderColor: expired ? "#6B7280" : "#EF4444",
                backgroundColor: expired ? "#111827" : "#1F0B0B",
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  color: expired ? "#D1D5DB" : "#FCA5A5",
                  fontSize: 12,
                  fontWeight: "900",
                  marginBottom: 6,
                }}
              >
                {t("order.card.acceptTimeTitle", "TIME TO ACCEPT")}
              </Text>

              <Text
                style={{
                  color: expired ? "#E5E7EB" : "#EF4444",
                  fontSize: 34,
                  fontWeight: "900",
                  letterSpacing: 1,
                }}
              >
                {expired ? "00:00" : fmtCountdown(rem)}
              </Text>

              <Text
                style={{
                  color: expired ? "#9CA3AF" : "#FCA5A5",
                  fontSize: 12,
                  marginTop: 6,
                }}
              >
                {expired
                  ? t("order.card.expired", "Expired")
                  : t("order.card.ringingActive", "Ringing active")}
              </Text>
            </View>
          )}

          <View
            style={{
              marginTop: 12,
              backgroundColor: "#020617",
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "#111827",
              padding: 14,
            }}
          >
            <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
              {t("order.card.totalLabel", "Total")}
            </Text>

            <Text
              style={{
                color: "#F9FAFB",
                fontWeight: "900",
                fontSize: 22,
                marginTop: 6,
              }}
            >
              {item.total != null
                ? `${Number(item.total).toFixed(2)} ${currency}`
                : t("common.na", "—")}
            </Text>
          </View>

          {showActions && (
            <View
              style={{
                flexDirection: "row",
                gap: 10,
                marginTop: 14,
              }}
            >
              <TouchableOpacity
                onPress={(e: any) => {
                  e?.stopPropagation?.();
                  confirmAccept(item.id);
                }}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 14,
                  backgroundColor: "rgba(34,197,94,0.15)",
                  borderWidth: 1,
                  borderColor: "rgba(34,197,94,0.45)",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "#BBF7D0", fontWeight: "900", fontSize: 14 }}>
                  {t("order.actions.accept", "Accept")}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={(e: any) => {
                  e?.stopPropagation?.();
                  confirmReject(item.id);
                }}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 14,
                  backgroundColor: "rgba(239,68,68,0.12)",
                  borderWidth: 1,
                  borderColor: "rgba(239,68,68,0.45)",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "#FCA5A5", fontWeight: "900", fontSize: 14 }}>
                  {t("order.actions.reject", "Reject")}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity
            onPress={(e: any) => {
              e?.stopPropagation?.();
              navigation.navigate("RestaurantChat", { orderId: item.id });
            }}
            style={{
              position: "absolute",
              right: 14,
              top: 14,
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(2,6,23,0.96)",
              borderWidth: 1,
              borderColor: "#1F2937",
            }}
          >
            <Text style={{ color: "#E5E7EB", fontSize: 17, fontWeight: "900" }}>
              💬
            </Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  const showLoadingUser = !resolveDone;
  const showNoRestaurant = resolveDone && !restaurantUserId;

  const headerTitle = useMemo(
    () => t("restaurant.orders.title", "Restaurant orders"),
    [t]
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#111827" }}>
      <StatusBar barStyle="light-content" />

      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 12 }}>
        <View
          style={{
            marginBottom: 16,
            paddingBottom: 12,
            borderBottomWidth: 1,
            borderBottomColor: "rgba(31,41,55,0.55)",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
            }}
          >
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              activeOpacity={0.85}
              style={{
                width: 42,
                height: 42,
                borderRadius: 21,
                alignItems: "center",
                justifyContent: "center",
                marginRight: 12,
                backgroundColor: "#0B1426",
                borderWidth: 1,
                borderColor: "#1F2937",
              }}
            >
              <Text style={{ color: "#93C5FD", fontWeight: "900", fontSize: 20 }}>
                ←
              </Text>
            </TouchableOpacity>

            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{
                  color: "white",
                  fontSize: 28,
                  fontWeight: "900",
                  lineHeight: 34,
                  flexShrink: 1,
                }}
              >
                {headerTitle}
              </Text>

              <Text
                style={{
                  color: "#6B7280",
                  fontWeight: "800",
                  marginTop: 4,
                  fontSize: 15,
                }}
              >
                {t("restaurant.orders.subtitle", "Manage live incoming orders")}
              </Text>
            </View>
          </View>

          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 10,
              marginTop: 14,
              paddingLeft: 54,
            }}
          >
            <HeaderAction
              label={t("restaurant.orders.earningsBtn", "Earnings")}
              onPress={() => navigation.navigate("RestaurantEarnings")}
              borderColor="#2563EB"
              backgroundColor="rgba(37,99,235,0.12)"
              textColor="#E5E7EB"
            />

            <HeaderAction
              label={t("auth.logoutShort", "Log out")}
              onPress={handleLogout}
              borderColor="#EF4444"
              backgroundColor="rgba(239,68,68,0.10)"
              textColor="#FCA5A5"
            />

            <HeaderAction
              label={t("common.refresh", "Refresh")}
              onPress={() => void fetchOrders()}
              borderColor="#4B5563"
              backgroundColor="transparent"
              textColor="#E5E7EB"
            />
          </View>
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
            backgroundColor: "#08112A",
            borderRadius: 18,
            borderWidth: 1,
            borderColor: "#1F2937",
            paddingHorizontal: 14,
            paddingVertical: 14,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
            <View
              style={{
                minWidth: 30,
                height: 30,
                borderRadius: 15,
                paddingHorizontal: 8,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#DC2626",
                marginRight: 10,
              }}
            >
              <Text style={{ color: "white", fontWeight: "900", fontSize: 12 }}>
                {counts.pending}
              </Text>
            </View>

            <Text style={{ color: "#FCA5A5", fontWeight: "900", fontSize: 15 }}>
              {t("restaurant.orders.pendingBadge", "Pending orders")}
            </Text>
          </View>
        </View>

        <View
          style={{
            flexDirection: "row",
            gap: 10,
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          <FilterChip
            label={t("common.all", "All")}
            count={counts.all}
            active={selectedFilter === "all"}
            onPress={() => setSelectedFilter("all")}
          />

          <FilterChip
            label={t("order.status.pending", "Pending")}
            count={counts.pending}
            active={selectedFilter === "pending"}
            onPress={() => setSelectedFilter("pending")}
            tone="danger"
          />

          <FilterChip
            label={t("order.status.prepared", "Preparing")}
            count={counts.preparing}
            active={selectedFilter === "prepared"}
            onPress={() => setSelectedFilter("prepared")}
            tone="warning"
          />

          <FilterChip
            label={t("order.status.readyPickup", "Ready")}
            count={counts.ready}
            active={selectedFilter === "ready"}
            onPress={() => setSelectedFilter("ready")}
            tone="success"
          />
        </View>

        {showLoadingUser ? (
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ color: "white", marginTop: 8 }}>
              {t("restaurant.orders.loadingAccount", "Loading restaurant account…")}
            </Text>
          </View>
        ) : showNoRestaurant ? (
          <View
            style={{
              marginTop: 12,
              backgroundColor: "#1F0B0B",
              borderColor: "#7F1D1D",
              borderWidth: 1,
              borderRadius: 16,
              padding: 14,
            }}
          >
            <Text style={{ color: "#FCA5A5", fontWeight: "900" }}>
              {t("restaurant.orders.noProfile", "Restaurant account not found.")}
            </Text>
          </View>
        ) : loading ? (
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
            <ActivityIndicator />
            <Text style={{ color: "white", marginTop: 8 }}>
              {t("restaurant.orders.loadingOrders", "Loading orders…")}
            </Text>
          </View>
        ) : filteredOrders.length === 0 ? (
          <View
            style={{
              marginTop: 12,
              backgroundColor: "#08112A",
              borderColor: "#1F2937",
              borderWidth: 1,
              borderRadius: 16,
              padding: 16,
            }}
          >
            <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
              {t("restaurant.orders.empty", "No active orders right now.")}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filteredOrders}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 22 }}
          />
        )}
      </View>
    </SafeAreaView>
  );
}