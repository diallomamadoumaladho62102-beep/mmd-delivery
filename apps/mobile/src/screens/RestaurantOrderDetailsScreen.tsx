import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { RestaurantBrandLoadingState } from "../components/restaurant/RestaurantBrandLoadingState";
import { API_BASE_URL } from "../lib/apiBase";
import {
  BOOT_AUTH_TIMEOUT_MS,
  withTimeout,
} from "../lib/bootFailOpen";
import { requestOrderPrint } from "../lib/restaurantOrderAutomationApi";
import { supabase } from "../lib/supabase";
import {
  subscribePostgresChannel,
  unsubscribeSupabaseChannel,
} from "../lib/supabaseRealtime";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_WHITE,
} from "../theme/mmdUi";

type OrderStatus =
  | "pending"
  | "accepted"
  | "prepared"
  | "ready"
  | "dispatched"
  | "delivered"
  | "canceled";

type OrderItem = {
  name: string;
  quantity: number;
  options?: unknown;
  notes?: unknown;
  category?: string | null;
  price?: number | null;
  unit_price?: number | null;
  line_total?: number | null;
};

type Order = {
  id: string;
  status: OrderStatus;
  created_at: string | null;
  restaurant_id?: string | null;
  restaurant_user_id?: string | null;
  client_id: string | null;
  client_user_id?: string | null;
  restaurant_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_code: string | null;
  items_json: unknown;
  leave_at_door: boolean | null;
  payment_status: string | null;
  kind: string | null;
};

type ClientProfile = {
  id: string;
  full_name: string | null;
  phone?: string | null;
};

const SELECT_FIELDS = [
  "id",
  "status",
  "created_at",
  "restaurant_id",
  "restaurant_user_id",
  "client_id",
  "client_user_id",
  "restaurant_name",
  "pickup_address",
  "dropoff_address",
  "pickup_code",
  "items_json",
  "leave_at_door",
  "payment_status",
  "kind",
].join(",");

function getApiUrl(path: string) {
  const base = String(API_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!base || !/^https?:\/\//i.test(base)) {
    throw new Error("API_BASE_URL doit être une URL absolue.");
  }
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function parseItems(value: unknown): OrderItem[] {
  if (Array.isArray(value)) return value as OrderItem[];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as OrderItem[]) : [];
  } catch {
    return [];
  }
}

function textLines(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(textLines);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(textLines);
  }
  return [];
}

function itemPriceLabel(item: OrderItem): string | null {
  const raw = item.line_total ?? item.unit_price ?? item.price;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return `$${Number(raw).toFixed(2)}`;
}

function statusLabel(status: OrderStatus) {
  const labels: Record<OrderStatus, string> = {
    pending: "Pending",
    accepted: "Accepted",
    prepared: "Prepared",
    ready: "Ready",
    dispatched: "Dispatched",
    delivered: "Delivered",
    canceled: "Canceled",
  };
  return labels[status];
}

function statusPillColor(status: OrderStatus) {
  switch (status) {
    case "pending":
      return "#EF4444";
    case "accepted":
    case "ready":
      return "#10B981";
    case "prepared":
      return "#F59E0B";
    case "canceled":
      return "#EF4444";
    default:
      return "rgba(255,255,255,0.2)";
  }
}

function canRestaurantCancel(status: OrderStatus) {
  return ["pending", "accepted", "prepared"].includes(status);
}

function canMoveToStatus(current: OrderStatus, next: OrderStatus) {
  return (
    (current === "pending" && next === "accepted") ||
    (current === "accepted" && next === "prepared") ||
    (current === "prepared" && next === "ready")
  );
}

export function RestaurantOrderDetailsScreen({ route }: any) {
  const { t } = useTranslation();
  const { orderId } = (route.params ?? {}) as { orderId?: string };
  const [order, setOrder] = useState<Order | null>(null);
  const [client, setClient] = useState<ClientProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [restaurantUserId, setRestaurantUserId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const items = useMemo(() => parseItems(order?.items_json), [order?.items_json]);
  const kitchenNotes = useMemo(
    () =>
      items.flatMap((item) =>
        textLines(item.notes).map((note) => `${item.name}: ${note}`)
      ),
    [items]
  );

  const resolveRestaurantUser = useCallback(async () => {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    const uid = authData.user?.id;
    if (!uid) {
      throw new Error(
        t("auth.errors.sessionExpired", "Session expirée. Reconnecte-toi puis réessaie.")
      );
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", uid)
      .maybeSingle();
    if (
      profileError ||
      String((profile as { role?: string } | null)?.role || "").toLowerCase() !==
        "restaurant"
    ) {
      throw new Error(
        t("order.errors.restaurantOnly", "Cette page est réservée au compte restaurant.")
      );
    }

    setRestaurantUserId(uid);
    return uid;
  }, [t]);

  const validateOrder = useCallback(
    (row: any, uid: string) => {
      const belongsToRestaurant =
        String(row?.restaurant_user_id || "") === uid ||
        String(row?.restaurant_id || "") === uid;
      if (!belongsToRestaurant) {
        throw new Error(
          t("order.errors.notAllowed", "Tu n’as pas accès à cette commande.")
        );
      }
      if (String(row?.payment_status || "").toLowerCase() !== "paid") {
        throw new Error(
          t(
            "order.errors.awaitingPayment",
            "Cette commande n’est pas encore payée et n’est pas visible."
          )
        );
      }
      if (String(row?.kind || "").toLowerCase() !== "food") {
        throw new Error(
          t(
            "order.errors.notFoodOrder",
            "Cette commande n’est pas une commande restaurant."
          )
        );
      }
    },
    [t]
  );

  const loadClient = useCallback(async (clientId: string | null) => {
    if (!clientId) {
      setClient(null);
      return;
    }

    const query = () =>
      supabase
        .from("profiles")
        .select("id, full_name, phone")
        .eq("id", clientId)
        .maybeSingle();
    const { data, error } = await query();
    if (!error) {
      setClient((data as ClientProfile | null) ?? null);
      return;
    }

    const fallback = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("id", clientId)
      .maybeSingle();
    setClient((fallback.data as ClientProfile | null) ?? null);
  }, []);

  const fetchOrder = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        await withTimeout(
          (async () => {
            if (!orderId) {
              setNotFound(true);
              setOrder(null);
              return;
            }
            const uid = restaurantUserId ?? (await resolveRestaurantUser());
            const { data, error } = await supabase
              .from("orders")
              .select(SELECT_FIELDS)
              .eq("id", orderId)
              .maybeSingle();
            if (error || !data) {
              throw (
                error ??
                new Error(t("order.errors.notFound", "Commande introuvable."))
              );
            }

            validateOrder(data, uid);
            const nextOrder = data as unknown as Order;
            setOrder(nextOrder);
            setNotFound(false);
            void loadClient(nextOrder.client_user_id ?? nextOrder.client_id);
          })(),
          BOOT_AUTH_TIMEOUT_MS,
          "restaurant_order_details_load",
        );
      } catch (error: any) {
        if (!silent) {
          setNotFound(true);
        }
        setOrder(null);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [loadClient, orderId, resolveRestaurantUser, restaurantUserId, t, validateOrder]
  );

  useEffect(() => {
    void fetchOrder();
  }, [fetchOrder]);

  useEffect(() => {
    if (!orderId) return;
    const channel = subscribePostgresChannel(`restaurant-order:${orderId}`, [
      {
        event: "*",
        table: "orders",
        filter: `id=eq.${orderId}`,
        callback: () => void fetchOrder(true),
      },
    ]);
    return () => {
      void unsubscribeSupabaseChannel(channel);
    };
  }, [fetchOrder, orderId]);

  const updateStatus = useCallback(
    async (next: "accepted" | "prepared" | "ready") => {
      if (!order || updating || !restaurantUserId || !canMoveToStatus(order.status, next))
        return;
      setUpdating(true);
      try {
        const { postRestaurantOrderStatus } = await import(
          "../lib/restaurantOrderStatusApi"
        );
        await postRestaurantOrderStatus({ orderId: order.id, status: next });
        await fetchOrder(true);
      } catch (error: any) {
        Alert.alert(
          t("common.errorTitle", "Erreur"),
          error?.message ??
            t("order.errors.update", "Impossible de mettre à jour le statut.")
        );
      } finally {
        setUpdating(false);
      }
    },
    [fetchOrder, order, restaurantUserId, t, updating]
  );

  const cancelOrder = useCallback(async () => {
    if (!order || updating || !canRestaurantCancel(order.status)) return;
    setUpdating(true);
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session?.access_token)
        throw new Error(error?.message || "Session expirée.");
      const response = await fetch(getApiUrl("/api/orders/cancel"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orderId: order.id, role: "restaurant" }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          result?.error || t("order.errors.cancel", "Impossible d’annuler cette commande.")
        );
      await fetchOrder(true);
    } catch (error: any) {
      Alert.alert(
        t("common.errorTitle", "Erreur"),
        error?.message ?? t("order.errors.cancel", "Impossible d’annuler cette commande.")
      );
    } finally {
      setUpdating(false);
    }
  }, [fetchOrder, order, t, updating]);

  const confirmCancel = useCallback(() => {
    if (!order) return;
    Alert.alert(
      order.status === "pending" ? "Refuse order" : "Cancel order",
      "Confirm this action?",
      [
        { text: "No", style: "cancel" },
        { text: "Confirm", style: "destructive", onPress: () => void cancelOrder() },
      ]
    );
  }, [cancelOrder, order]);

  const handlePrint = useCallback(
    async (source: "manual" | "reprint") => {
      if (!order || printing) return;
      setPrinting(true);
      try {
        await requestOrderPrint(order.id, source);
        Alert.alert(
          t("restaurant.orderPrint.title", "Print"),
          source === "reprint"
            ? t("restaurant.orderPrint.reprintQueued", "Reprint queued.")
            : t("restaurant.orderPrint.ticketQueued", "Ticket added to print queue."),
        );
      } catch (error) {
        Alert.alert(
          t("restaurant.orderPrint.title", "Print"),
          error instanceof Error
            ? error.message
            : t("restaurant.orderPrint.printFailed", "Unable to start printing."),
        );
      } finally {
        setPrinting(false);
      }
    },
    [order, printing, t]
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
        <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
        <ScreenHeader
          title={t("restaurant.orderDetails.title", "Order")}
          fallbackRoute="RestaurantCommandCenter"
          variant="mmd"
        />
        <RestaurantBrandLoadingState
          variant="card"
          showLogo
          glass
          title={t("restaurant.orderDetails.loading", "Loading Order...")}
          subtitle={t(
            "restaurant.orderDetails.loadingSubtitle",
            "Fetching order details"
          )}
        />
      </SafeAreaView>
    );
  }

  if (!order || notFound) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
        <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
        <ScreenHeader
          title={t("restaurant.orderDetails.title", "Order")}
          fallbackRoute="RestaurantCommandCenter"
          variant="mmd"
        />
        <View style={styles.center}>
          <View style={styles.stateCard}>
            <Text style={styles.stateIcon}>❌</Text>
            <Text style={styles.stateTitle}>
              {t("restaurant.orderDetails.notFoundTitle", "Order Not Found")}
            </Text>
            <Text style={styles.stateBody}>
              {t(
                "restaurant.orderDetails.notFoundBody",
                "This order could not be found."
              )}
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const clientId = order.client_user_id ?? order.client_id;
  const clientName =
    client?.full_name?.trim() ||
    (clientId ? `Client ${clientId.slice(0, 8)}` : "Customer");
  const canPrint = ["accepted", "prepared", "ready", "dispatched"].includes(
    order.status
  );
  const shortId = order.id.slice(0, 8);

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={t("restaurant.orderDetails.title", "Order")}
        fallbackRoute="RestaurantCommandCenter"
        variant="mmd"
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statusRow}>
          <Text style={styles.orderTitle}>📋 Order #{shortId}</Text>
          <View style={styles.statusRule} />
          <View
            style={[
              styles.statusPill,
              { backgroundColor: statusPillColor(order.status) },
            ]}
          >
            <Text style={styles.statusPillText}>{statusLabel(order.status)}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>👤 Customer</Text>
          <Text style={styles.cardValue}>{clientName}</Text>
        </View>

        <View style={styles.pickupCard}>
          <Text style={styles.pickupCode}>{order.pickup_code || "—"}</Text>
          <Text style={styles.pickupHelp}>
            {t("restaurant.orderDetails.showToDriver", "Show to driver")}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>🛒 Items</Text>
          {items.length ? (
            items.map((item, index) => {
              const price = itemPriceLabel(item);
              return (
                <View key={`${item.name}-${index}`} style={styles.itemRow}>
                  <View style={styles.qtyBadge}>
                    <Text style={styles.qtyText}>{item.quantity}</Text>
                  </View>
                  <Text style={styles.itemName} numberOfLines={2}>
                    {item.name}
                  </Text>
                  {price ? <Text style={styles.itemPrice}>{price}</Text> : null}
                </View>
              );
            })
          ) : (
            <Text style={styles.muted}>
              {t("restaurant.orderDetails.noItems", "No items.")}
            </Text>
          )}
        </View>

        {kitchenNotes.length || order.leave_at_door ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>📝 Notes</Text>
            <Text style={styles.notesBody}>
              {[
                ...kitchenNotes,
                order.leave_at_door ? "Leave at door" : null,
              ]
                .filter(Boolean)
                .join(" • ")}
            </Text>
          </View>
        ) : null}

        <View style={styles.workflow}>
          {order.status === "pending" ? (
            <WorkflowButton
              label="Accept"
              tone="green"
              onPress={() => void updateStatus("accepted")}
              disabled={updating}
            />
          ) : null}
          {order.status === "accepted" || order.status === "prepared" ? (
            <WorkflowButton
              label="Prepared"
              tone="yellow"
              onPress={() => void updateStatus("prepared")}
              disabled={updating || order.status !== "accepted"}
            />
          ) : null}
          {order.status === "accepted" || order.status === "prepared" ? (
            <WorkflowButton
              label="Ready"
              tone="green"
              onPress={() => void updateStatus("ready")}
              disabled={updating || order.status !== "prepared"}
            />
          ) : null}
          {canPrint ? (
            <WorkflowButton
              label={printing ? "Printing…" : "Print"}
              tone="ghost"
              onPress={() => void handlePrint("manual")}
              disabled={printing || updating}
            />
          ) : null}
          {canRestaurantCancel(order.status) ? (
            <WorkflowButton
              label={order.status === "pending" ? "Refuse" : "Cancel"}
              tone="danger"
              onPress={confirmCancel}
              disabled={updating}
            />
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function WorkflowButton({
  label,
  onPress,
  disabled,
  tone,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  tone: "yellow" | "green" | "ghost" | "danger";
}) {
  const bg =
    tone === "yellow"
      ? "#EFE144"
      : tone === "green"
        ? "#10B921"
        : tone === "danger"
          ? "#EF4444"
          : MMD_BLUE;
  const color = tone === "yellow" ? "#EF4444" : MMD_WHITE;
  const border = tone === "ghost" || tone === "danger" || tone === "green";

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.workflowButton,
        {
          backgroundColor: bg,
          borderWidth: border ? 1 : 0,
          borderColor: MMD_WHITE,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
      activeOpacity={0.88}
    >
      <Text style={[styles.workflowText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 12,
  },
  stateCard: {
    width: 280,
    maxWidth: "100%",
    borderRadius: 24,
    padding: 32,
    gap: 16,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  stateIcon: { fontSize: 48 },
  stateTitle: {
    color: MMD_WHITE,
    fontSize: 20,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    textAlign: "center",
  },
  stateBody: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
    textAlign: "center",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  orderTitle: {
    color: MMD_WHITE,
    fontSize: 18,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  statusRule: {
    flex: 1,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  statusPillText: {
    color: MMD_WHITE,
    fontSize: 11,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 20,
    padding: 16,
    gap: 10,
  },
  cardLabel: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 12,
    fontFamily: MMD_FONT.regular,
  },
  cardValue: {
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  pickupCard: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 22,
    paddingVertical: 20,
    alignItems: "center",
    gap: 6,
  },
  pickupCode: {
    color: MMD_WHITE,
    fontSize: 32,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  pickupHelp: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 12,
    fontFamily: MMD_FONT.regular,
  },
  sectionTitle: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  qtyBadge: {
    minWidth: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: "#10B981",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  qtyText: {
    color: MMD_WHITE,
    fontSize: 12,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  itemName: {
    flex: 1,
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  itemPrice: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
  },
  muted: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
  },
  notesBody: {
    color: MMD_WHITE,
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
    lineHeight: 18,
  },
  workflow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  workflowButton: {
    minWidth: 150,
    flexGrow: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  workflowText: {
    fontSize: 13,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
});

export default RestaurantOrderDetailsScreen;
