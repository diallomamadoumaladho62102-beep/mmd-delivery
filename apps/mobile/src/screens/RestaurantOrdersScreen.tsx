// apps/mobile/src/screens/RestaurantOrdersScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StatusBar,
  FlatList,
  TouchableOpacity,
  AppState,
  AppStateStatus,
  Alert,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import {
  subscribePostgresChannel,
  unsubscribeSupabaseChannel,
} from "../lib/supabaseRealtime";
import { useTranslation } from "react-i18next";
import { useRestaurantAutoPrint } from "../hooks/useRestaurantAutoPrint";
import { fetchRestaurantAutomationSettings } from "../lib/restaurantOrderAutomationApi";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { RestaurantBrandLoadingState } from "../components/restaurant/RestaurantBrandLoadingState";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GLASS,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../theme/mmdUi";

const ACCEPT_WINDOW_SECONDS = 180;

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

type FilterKey = "all" | "pending" | "ready";

type OrderRow = {
  id: string;
  kind?: string | null;
  status: DbOrderStatus | string;
  created_at: string | null;
  currency: string | null;
  total: number | null;
  grand_total: number | null;
  total_cents: number | null;
  restaurant_accept_expires_at: string | null;
  items_json?: unknown;
};

type Order = {
  id: string;
  status: OrderStatus;
  total: number | null;
  created_at: string | null;
  currency: string | null;
  restaurant_accept_expires_at: string | null;
  itemCount: number;
};

const ACTIVE_STATUSES_UI: OrderStatus[] = [
  "pending",
  "accepted",
  "prepared",
  "ready",
  "dispatched",
];

const NEXT_ALLOWED_STATUS: Partial<Record<OrderStatus, DbOrderStatus[]>> = {
  pending: ["accepted", "canceled"],
  accepted: ["prepared", "canceled"],
  prepared: ["ready", "canceled"],
  ready: ["dispatched", "canceled"],
};

function canMoveToStatus(currentStatus: OrderStatus, nextStatus: DbOrderStatus) {
  return NEXT_ALLOWED_STATUS[currentStatus]?.includes(nextStatus) ?? false;
}

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

function countItems(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }
  return 0;
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

function statusBadgeColor(status: OrderStatus | "expired"): string {
  switch (status) {
    case "pending":
      return "#EF4444";
    case "prepared":
    case "accepted":
      return "#F59E0B";
    case "ready":
      return MMD_TAXI_GREEN;
    case "expired":
      return "rgba(229,231,235,0.1)";
    default:
      return "rgba(255,255,255,0.2)";
  }
}

function FilterChip({
  label,
  active,
  onPress,
  tone = "default",
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  tone?: "default" | "danger" | "success";
}) {
  const bg =
    tone === "danger"
      ? "#EF4444"
      : tone === "success"
        ? MMD_TAXI_GREEN
        : active
          ? MMD_WHITE
          : "rgba(255,255,255,0.12)";
  const color =
    tone === "default" && active
      ? MMD_BLUE
      : tone === "default"
        ? MMD_WHITE
        : MMD_WHITE;

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      activeOpacity={0.88}
      onPress={onPress}
      style={[
        styles.filterChip,
        {
          backgroundColor: bg,
          borderColor: tone === "default" && !active ? "rgba(255,255,255,0.2)" : bg,
          borderWidth: 1,
        },
      ]}
    >
      <Text
        style={{
          color,
          fontFamily: active || tone !== "default" ? MMD_FONT.bold : MMD_FONT.semibold,
          fontWeight: active || tone !== "default" ? "700" : "600",
          fontSize: 13,
        }}
      >
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
  const [autoPrintEnabled, setAutoPrintEnabled] = useState(false);

  useRestaurantAutoPrint(autoPrintEnabled);

  useEffect(() => {
    void (async () => {
      try {
        const result = await fetchRestaurantAutomationSettings();
        setAutoPrintEnabled(Boolean(result.settings.auto_print_enabled));
      } catch {
        setAutoPrintEnabled(false);
      }
    })();
  }, []);

  const fetchingRef = useRef(false);
  const mountedRef = useRef(true);

  const [, forceTick] = useState(0);
  const hasPendingValidRef = useRef(false);
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
    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;

        const uid = data?.user?.id ?? null;

        if (!uid) {
          if (!cancelled && mountedRef.current) {
            setRestaurantUserId(null);
          }
          return;
        }

        const { data: roleProfile, error: roleError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", uid)
          .maybeSingle();

        if (roleError) {
          console.log("resolve restaurant role error:", roleError);
        }

        const role = String((roleProfile as any)?.role || "")
          .trim()
          .toLowerCase();

        if (role && role !== "restaurant") {
          if (!cancelled && mountedRef.current) {
            setRestaurantUserId(null);
          }

          navigation.reset({
            index: 0,
            routes: [
              {
                name:
                  role === "driver"
                    ? "DriverTabs"
                    : role === "client"
                      ? "ClientHome"
                      : "RoleSelect",
              },
            ],
          });
          return;
        }

        const { data: restaurantProfile, error: restaurantError } = await supabase
          .from("restaurant_profiles")
          .select("user_id,status")
          .eq("user_id", uid)
          .maybeSingle();

        if (restaurantError) {
          console.log("resolve restaurant profile error:", restaurantError);
        }

        const isRestaurantProfile =
          !!restaurantProfile &&
          String((restaurantProfile as any)?.user_id || "") === uid;

        if (!cancelled && mountedRef.current) {
          setRestaurantUserId(isRestaurantProfile ? uid : null);
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
  }, [navigation]);

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
      hasPendingValidRef.current = computeHasPendingValid(rows);
    },
    [computeHasPendingValid]
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
            "id,kind,status,created_at,currency,total,grand_total,total_cents,restaurant_accept_expires_at,items_json"
          )
          .eq("kind", "food")
          .eq("payment_status", "paid")
          .or(
            `restaurant_user_id.eq.${restaurantUserId},restaurant_id.eq.${restaurantUserId}`
          )
          .order("created_at", { ascending: false });

        if (error) throw error;

        const mapped: Order[] = ((data || []) as OrderRow[])
          .filter((row) => String(row?.kind ?? "food").toLowerCase() === "food")
          .map((row: OrderRow) => {
            const uiStatus = mapDbStatusToUiStatus(row.status);

            return {
              id: String(row.id),
              status: uiStatus,
              created_at: row.created_at ?? null,
              currency: row.currency ?? "USD",
              total: pickTotal(row),
              restaurant_accept_expires_at: row.restaurant_accept_expires_at ?? null,
              itemCount: countItems(row.items_json),
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
      if (!restaurantUserId) return;

      try {
        const { data: u, error: ue } = await supabase.auth.getUser();
        if (ue) throw ue;

        const actorId = u?.user?.id ?? null;

        if (!actorId || actorId !== restaurantUserId) {
          throw new Error(
            t(
              "restaurant.orders.errors.invalidActor",
              "Session restaurant invalide. Reconnecte-toi puis réessaie."
            )
          );
        }

        const { data: current, error: ce } = await supabase
          .from("orders")
          .select(
            "id,kind,status,created_at,restaurant_accept_expires_at,restaurant_user_id,restaurant_id"
          )
          .eq("id", orderId)
          .eq("kind", "food")
          .eq("payment_status", "paid")
          .or(
            `restaurant_user_id.eq.${restaurantUserId},restaurant_id.eq.${restaurantUserId}`
          )
          .maybeSingle();

        if (ce) throw ce;

        if (!current) {
          throw new Error(
            t(
              "restaurant.orders.errors.orderNotFound",
              "Commande introuvable pour ce restaurant."
            )
          );
        }

        const oldStatus = mapDbStatusToUiStatus(
          String((current as any)?.status ?? "")
        );

        if (!canMoveToStatus(oldStatus, nextStatus)) {
          throw new Error(
            t(
              "restaurant.orders.errors.invalidTransition",
              "Cette commande a déjà changé de statut. Rafraîchis la liste."
            )
          );
        }

        if (oldStatus === "pending" && nextStatus === "accepted") {
          const remaining = remainingAcceptSeconds(
            (current as any)?.restaurant_accept_expires_at ?? null,
            (current as any)?.created_at ?? null
          );

          if (remaining <= 0) {
            throw new Error(
              t(
                "restaurant.orders.errors.acceptExpired",
                "Le délai d’acceptation est expiré. Tu ne peux plus accepter cette commande."
              )
            );
          }
        }

        if (nextStatus === "canceled") {
          const { postRestaurantOrderReject } = await import(
            "../lib/restaurantOrderStatusApi"
          );
          await postRestaurantOrderReject({ orderId });
        } else {
          const { postRestaurantOrderStatus } = await import(
            "../lib/restaurantOrderStatusApi"
          );
          await postRestaurantOrderStatus({
            orderId,
            status: nextStatus as "accepted" | "prepared" | "ready",
          });
        }

        void fetchOrders({ silent: true });
      } catch (e: any) {
        Alert.alert(
          t("common.errorTitle", "Error"),
          e?.message ?? t("common.error", "Something went wrong.")
        );
      }
    },
    [fetchOrders, restaurantUserId, t]
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

  useEffect(() => {
    if (!restaurantUserId) return;
    void fetchOrders();
  }, [restaurantUserId, fetchOrders]);

  useEffect(() => {
    if (!restaurantUserId) return;

    const ch = subscribePostgresChannel(`restaurant-orders-${restaurantUserId}`, [
      {
        event: "*",
        table: "orders",
        filter: `restaurant_user_id=eq.${restaurantUserId}`,
        callback: () => {
          void fetchOrders({ silent: true });
        },
      },
    ]);

    return () => {
      void unsubscribeSupabaseChannel(ch);
    };
  }, [restaurantUserId, fetchOrders]);

  useEffect(() => {
    if (!restaurantUserId) return;

    const id = setInterval(() => {
      void fetchOrders({ silent: true });
    }, 15000);

    return () => clearInterval(id);
  }, [restaurantUserId, fetchOrders]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
      if (s === "active") {
        void fetchOrders({ silent: true });
      }
    });

    return () => sub.remove();
  }, [fetchOrders]);

  useEffect(() => {
    const id = setInterval(() => {
      if (!mountedRef.current) return;

      forceTick((x) => x + 1);

      const currentOrders = ordersRef.current ?? [];
      hasPendingValidRef.current = computeHasPendingValid(currentOrders);
    }, 5000);

    return () => clearInterval(id);
  }, [computeHasPendingValid]);

  const statusLabel = useCallback(
    (s: OrderStatus | "expired") => {
      switch (s) {
        case "pending":
          return t("order.status.pendingLower", "pending");
        case "accepted":
          return t("order.status.acceptedLower", "accepted");
        case "prepared":
          return t("order.status.preparedLower", "prepared");
        case "ready":
          return t("order.status.readyLower", "ready");
        case "dispatched":
          return t("order.status.dispatchedLower", "dispatched");
        case "delivered":
          return t("order.status.deliveredLower", "delivered");
        case "canceled":
          return t("order.status.canceledLower", "canceled");
        case "expired":
          return t("order.status.expiredLower", "expired");
        default:
          return String(s);
      }
    },
    [t]
  );

  const filteredOrders = useMemo(() => {
    if (selectedFilter === "pending") {
      return orders.filter((o) => o.status === "pending");
    }

    if (selectedFilter === "ready") {
      return orders.filter((o) => o.status === "ready");
    }

    return orders;
  }, [orders, selectedFilter]);

  const alertOrder = useMemo(() => {
    return orders.find((o) => isPendingValid(o)) ?? null;
  }, [orders, isPendingValid]);

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
    const badgeStatus: OrderStatus | "expired" = expired ? "expired" : item.status;
    const shortId = item.id.slice(0, 8);
    const totalLabel =
      item.total != null
        ? `${currency === "USD" ? "$" : ""}${Number(item.total).toFixed(2)}${
            currency !== "USD" ? ` ${currency}` : ""
          }`
        : t("common.na", "—");
    const metaLine = t("restaurant.orders.cardMeta", {
      defaultValue: "{{count}} items • {{total}}",
      count: item.itemCount,
      total: totalLabel,
    });

    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t("restaurant.orders.openOrder", {
          defaultValue: "Order {{id}}, {{status}}, {{meta}}",
          id: shortId,
          status: badgeStatus,
          meta: metaLine,
        })}
        activeOpacity={0.92}
        onPress={() =>
          navigation.navigate("RestaurantOrderDetails", { orderId: item.id })
        }
      >
        <View style={styles.orderCard}>
          <View style={styles.orderTop}>
            <Text style={styles.orderNumber}>📋 #{shortId}</Text>
            <View
              style={[
                styles.statusPill,
                {
                  backgroundColor: statusBadgeColor(badgeStatus),
                  borderColor:
                    badgeStatus === "expired"
                      ? "rgba(229,231,235,0.2)"
                      : statusBadgeColor(badgeStatus),
                },
              ]}
            >
              <Text
                style={[
                  styles.statusPillText,
                  badgeStatus === "expired" ? { color: "#E5E7EB" } : null,
                ]}
              >
                {statusLabel(badgeStatus)}
              </Text>
            </View>
          </View>

          <Text style={styles.metaLine}>{metaLine}</Text>

          {item.status === "pending" ? (
            <View
              style={[
                styles.countdownRow,
                expired ? styles.countdownExpired : styles.countdownActive,
              ]}
            >
              <Text
                style={[
                  styles.countdownLabel,
                  expired ? styles.countdownTextMuted : styles.countdownTextAmber,
                ]}
              >
                {expired
                  ? t("order.card.expired", "Expired")
                  : t("order.card.acceptWithin", "⏱️ Accept within")}
              </Text>
              <View
                style={[
                  styles.countdownRule,
                  expired ? styles.countdownRuleMuted : styles.countdownRuleAmber,
                ]}
              />
              <Text
                style={[
                  styles.countdownValue,
                  expired ? styles.countdownTextMuted : styles.countdownTextAmber,
                ]}
              >
                {expired ? "00:00" : fmtCountdown(rem)}
              </Text>
            </View>
          ) : null}

          {showActions ? (
            <View style={styles.actionsRow}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={t("order.actions.accept", "Accept")}
                onPress={(e: any) => {
                  e?.stopPropagation?.();
                  confirmAccept(item.id);
                }}
                style={[styles.actionBtn, styles.acceptBtn]}
                activeOpacity={0.88}
              >
                <Text style={styles.actionBtnText}>
                  {t("order.actions.accept", "Accept")}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={t("order.actions.refuse", "Refuse")}
                onPress={(e: any) => {
                  e?.stopPropagation?.();
                  confirmReject(item.id);
                }}
                style={[styles.actionBtn, styles.refuseBtn]}
                activeOpacity={0.88}
              >
                <Text style={styles.actionBtnText}>
                  {t("order.actions.refuse", "Refuse")}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  const showLoadingUser = !resolveDone;
  const showNoRestaurant = resolveDone && !restaurantUserId;
  const showLoadingOrders = resolveDone && !!restaurantUserId && loading;

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />

      <ScreenHeader
        title={t("restaurant.orders.title", "Orders")}
        fallbackRoute="RestaurantCommandCenter"
        variant="mmd"
      />

      {showLoadingUser || showLoadingOrders ? (
        <RestaurantBrandLoadingState
          variant="card"
          showLogo
          glass
          title={t("restaurant.orders.loadingOrders", "Loading Orders...")}
          subtitle={t(
            "restaurant.orders.loadingOrdersSubtitle",
            "Fetching your orders"
          )}
        />
      ) : showNoRestaurant ? (
        <View style={styles.bodyPad}>
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              {t("restaurant.orders.noProfile", "Restaurant account not found.")}
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.content}>
          {alertOrder ? (
            <View style={styles.alertBanner}>
              <View style={styles.alertIconWrap}>
                <Text style={styles.alertIcon}>🔔</Text>
              </View>
              <View style={styles.alertCopy}>
                <Text style={styles.alertTitle}>
                  {t("restaurant.orders.alertTitle", "New order")}
                </Text>
                <Text style={styles.alertBody} numberOfLines={2}>
                  {t("restaurant.orders.alertBody", {
                    defaultValue: "Order #{{id}} waiting - tap to review",
                    id: alertOrder.id.slice(0, 8),
                  })}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.alertOpen}
                activeOpacity={0.88}
                onPress={() =>
                  navigation.navigate("RestaurantOrderDetails", {
                    orderId: alertOrder.id,
                  })
                }
              >
                <Text style={styles.alertOpenText}>
                  {t("restaurant.orders.alertOpen", "Open")}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.filters}>
            <FilterChip
              label={t("common.all", "All")}
              active={selectedFilter === "all"}
              onPress={() => setSelectedFilter("all")}
            />
            <FilterChip
              label={t("order.status.pending", "Pending")}
              active={selectedFilter === "pending"}
              onPress={() => setSelectedFilter("pending")}
              tone="danger"
            />
            <FilterChip
              label={t("order.status.readyPickup", "Ready")}
              active={selectedFilter === "ready"}
              onPress={() => setSelectedFilter("ready")}
              tone="success"
            />
          </View>

          {filteredOrders.length === 0 ? (
            <View style={styles.emptyWrap}>
              <View style={styles.emptyCard}>
                <View style={styles.emptyIconWrap}>
                  <Text style={styles.emptyIcon}>📦</Text>
                </View>
                <Text style={styles.emptyTitle}>
                  {t("restaurant.orders.emptyTitle", "No Active Orders")}
                </Text>
                <Text style={styles.emptyBody}>
                  {t(
                    "restaurant.orders.emptyBody",
                    "New orders will appear here automatically"
                  )}
                </Text>
              </View>
            </View>
          ) : (
            <FlatList
              data={filteredOrders}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
            />
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 12,
  },
  bodyPad: {
    flex: 1,
    paddingHorizontal: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  filters: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  alertBanner: {
    backgroundColor: "#10B981",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  alertIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  alertIcon: { fontSize: 14 },
  alertCopy: { flex: 1, gap: 2 },
  alertTitle: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  alertBody: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
  },
  alertOpen: {
    backgroundColor: MMD_WHITE,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  alertOpenText: {
    color: MMD_BLUE,
    fontSize: 13,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  orderCard: {
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 16,
    padding: 16,
    gap: 12,
    marginBottom: 12,
  },
  orderTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  orderNumber: {
    color: MMD_WHITE,
    fontSize: 18,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusPillText: {
    color: MMD_WHITE,
    fontSize: 11,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  metaLine: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
  },
  countdownRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  countdownActive: {
    backgroundColor: "rgba(245,158,11,0.1)",
    borderColor: "rgba(245,158,11,0.4)",
  },
  countdownExpired: {
    backgroundColor: "rgba(229,231,235,0.1)",
    borderColor: "rgba(229,231,235,0.2)",
  },
  countdownLabel: {
    fontSize: 12,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  countdownValue: {
    fontSize: 14,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  countdownTextAmber: { color: "#F59E0B" },
  countdownTextMuted: { color: "#E5E7EB" },
  countdownRule: { flex: 1, height: 1 },
  countdownRuleAmber: { backgroundColor: "rgba(245,158,11,0.4)", opacity: 0.6 },
  countdownRuleMuted: { backgroundColor: "rgba(229,231,235,0.2)" },
  actionsRow: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 12,
    padding: 4,
  },
  actionBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 12,
  },
  acceptBtn: { backgroundColor: MMD_TAXI_GREEN },
  refuseBtn: {
    backgroundColor: "#EF4444",
    borderWidth: 1,
    borderColor: "#EF4444",
  },
  actionBtnText: {
    color: MMD_WHITE,
    fontSize: 13,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
  },
  emptyCard: {
    width: 280,
    maxWidth: "100%",
    borderRadius: 24,
    padding: 24,
    gap: 16,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  emptyIcon: { fontSize: 32 },
  emptyTitle: {
    color: MMD_WHITE,
    fontSize: 20,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    textAlign: "center",
  },
  emptyBody: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
    textAlign: "center",
  },
  listContent: { paddingBottom: 32 },
});

export default RestaurantOrdersScreen;
