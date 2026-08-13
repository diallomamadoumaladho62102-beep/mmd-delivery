import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  AppState,
  StatusBar,
  StyleSheet,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { loadOwnSeller, loadSellerOrders } from "../../lib/sellerApi";
import { formatMoney, type SellerOrderRow } from "../../lib/sellerTypes";
import { updateMarketplaceSellerOrderStatus } from "../../lib/marketplaceApi";
import { useTranslation } from "react-i18next";
import { toUserFacingError } from "../../lib/userFacingError";
import { rowDirection } from "../../i18n/rtl";
import {
  subscribePostgresChannel,
  unsubscribeSupabaseChannel,
} from "../../lib/supabaseRealtime";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { MARKETPLACE_LIST_PERF } from "../../lib/listPerf";
import {
  SellerBottomNav,
  SellerBrandHeader,
  SellerFeedbackCard,
  SellerGlassCard,
} from "../../components/seller/SellerChrome";
import { formatDateTime } from "../../i18n/formatters";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_GLASS,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../../theme/mmdUi";

type Props = { navigation: any };
type FilterKey = "all" | "pending" | "accepted" | "refused";

function statusTone(status: string): { bg: string; color: string; label: string } {
  const s = status.toLowerCase();
  if (s === "refused") {
    return { bg: "rgba(239,68,68,0.13)", color: "#EF4444", label: "Refused" };
  }
  if (s === "accepted" || s === "preparing" || s === "ready" || s === "out_for_delivery") {
    return {
      bg: "rgba(34,197,94,0.13)",
      color: MMD_TAXI_GREEN,
      label: s === "out_for_delivery" ? "Out for delivery" : "Accepted",
    };
  }
  if (s === "paid" || s === "confirmed" || s === "pending") {
    return { bg: "rgba(245,158,11,0.13)", color: "#F59E0B", label: "Pending" };
  }
  return { bg: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.8)", label: status };
}

export default function SellerOrdersScreen({ navigation }: Props) {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [orders, setOrders] = useState<SellerOrderRow[]>([]);
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const channelRef = useRef<RealtimeChannel | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const seller = await loadOwnSeller();
      if (!seller) {
        navigation.replace("SellerOnboarding");
        return;
      }
      setSellerId(seller.id);
      setOrders(await loadSellerOrders(seller.id));
    } catch (e) {
      console.log("SellerOrders refresh error:", e);
    } finally {
      setLoading(false);
    }
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  useEffect(() => {
    if (!sellerId) return;

    void unsubscribeSupabaseChannel(channelRef.current);
    channelRef.current = subscribePostgresChannel(
      `seller-orders:${sellerId}`,
      [
        {
          event: "*",
          table: "seller_orders",
          filter: `seller_id=eq.${sellerId}`,
          callback: () => {
            void refresh();
          },
        },
      ]
    );

    const appSub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });

    return () => {
      appSub.remove();
      void unsubscribeSupabaseChannel(channelRef.current);
      channelRef.current = null;
    };
  }, [sellerId, refresh]);

  const filtered = useMemo(() => {
    if (filter === "all") return orders;
    if (filter === "pending") {
      return orders.filter((o) =>
        ["paid", "confirmed", "pending"].includes(o.status.toLowerCase())
      );
    }
    if (filter === "accepted") {
      return orders.filter((o) =>
        ["accepted", "preparing", "ready", "out_for_delivery"].includes(
          o.status.toLowerCase()
        )
      );
    }
    return orders.filter((o) => o.status.toLowerCase() === "refused");
  }, [orders, filter]);

  const actionsFor = useMemo(
    () =>
      (
        status: string
      ): Array<"accepted" | "refused" | "preparing" | "ready" | "out_for_delivery"> => {
        if (status === "paid" || status === "confirmed") return ["accepted", "refused"];
        if (status === "accepted") return ["preparing"];
        if (status === "preparing") return ["ready"];
        if (status === "ready") return ["out_for_delivery"];
        return [];
      },
    []
  );

  async function applyStatus(
    order: SellerOrderRow,
    status: "accepted" | "refused" | "preparing" | "ready" | "out_for_delivery"
  ) {
    try {
      setBusyId(order.id);
      const result = await updateMarketplaceSellerOrderStatus({
        orderId: order.id,
        status,
      });
      if (result.stripe_refund_deferred) {
        Alert.alert(
          t("seller.orders.refundRetryTitle", "Refund pending retry"),
          result.message ??
            t(
              "seller.orders.refundRetryBody",
              "Order refused. Stripe refund did not complete automatically and will be retried."
            )
        );
      } else if (status === "refused" && result.refund_status === "refunded") {
        Alert.alert(
          t("seller.orders.refundedTitle", "Refund completed"),
          t(
            "seller.orders.refundedBody",
            "Order refused and the customer was refunded on Stripe."
          )
        );
      }
      await refresh();
    } catch (e) {
      Alert.alert(
        t("common.errorTitle", "Error"),
        toUserFacingError(e, "Unable to update order")
      );
    } finally {
      setBusyId(null);
    }
  }

  const filters: Array<{ key: FilterKey; label: string }> = [
    { key: "all", label: t("seller.orders.filterAll", "All") },
    { key: "pending", label: t("seller.orders.filterPending", "Pending") },
    { key: "accepted", label: t("seller.orders.filterAccepted", "Accepted") },
    { key: "refused", label: t("seller.orders.filterRefused", "Refused") },
  ];

  return (
    <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" />
      <SellerBrandHeader
        subtitle={t("seller.orders.title", "Orders")}
        showBack
        fallbackRoute="SellerDashboard"
      />

      {loading ? (
        <SellerFeedbackCard
          loading
          title={t("common.loading", "Loading...")}
          message={t("seller.orders.loading", "Fetching your orders")}
        />
      ) : orders.length === 0 ? (
        <SellerFeedbackCard
          icon="📋"
          title={t("seller.orders.emptyTitle", "No Orders Yet")}
          message={t(
            "seller.orders.emptyBody",
            "Orders from the marketplace will appear here"
          )}
        />
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
          >
            {filters.map((f) => {
              const active = filter === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  onPress={() => setFilter(f.key)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            {...MARKETPLACE_LIST_PERF}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <Text style={styles.emptyFilter}>
                {t("seller.orders.filterEmpty", "No orders in this filter.")}
              </Text>
            }
            renderItem={({ item }) => {
              const actions = actionsFor(item.status);
              const tone = statusTone(item.status);
              return (
                <SellerGlassCard style={styles.card}>
                  <View style={styles.cardTop}>
                    <Text style={styles.orderId}>
                      📋 #{item.id.slice(0, 8)}
                    </Text>
                    <View style={[styles.pill, { backgroundColor: tone.bg }]}>
                      <Text style={[styles.pillText, { color: tone.color }]}>
                        {tone.label}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.amount}>
                    {formatMoney(item.total_cents, item.currency)}
                  </Text>
                  <Text style={styles.meta}>
                    {formatDateTime(item.created_at, i18n.language)}
                  </Text>
                  {item.refund_status ? (
                    <Text style={styles.refund}>
                      {t("seller.orders.refundStatus", "Refund")}: {item.refund_status}
                    </Text>
                  ) : null}
                  {item.notes ? (
                    <Text style={styles.notes}>{item.notes}</Text>
                  ) : null}
                  {actions.length > 0 ? (
                    <View style={{ flexDirection: rowDirection(), flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                      {actions.map((action) => (
                        <TouchableOpacity
                          key={action}
                          disabled={busyId === item.id}
                          onPress={() => void applyStatus(item, action)}
                          style={[
                            styles.actionBtn,
                            {
                              backgroundColor:
                                action === "refused" ? "#EF4444" : MMD_TAXI_GREEN,
                              opacity: busyId === item.id ? 0.6 : 1,
                            },
                          ]}
                        >
                          <Text style={styles.actionLabel}>
                            {action === "accepted"
                              ? t("seller.orders.accept", "Accept")
                              : action === "refused"
                                ? t("seller.orders.refuse", "Refuse")
                                : action === "preparing"
                                  ? t("seller.orders.preparing", "Preparing")
                                  : action === "ready"
                                    ? t("seller.orders.ready", "Ready")
                                    : t("seller.orders.outForDelivery", "Out for delivery")}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                </SellerGlassCard>
              );
            }}
          />
        </>
      )}

      <SellerBottomNav active="orders" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MMD_BLUE },
  filters: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  chip: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  chipActive: {
    backgroundColor: MMD_GOLD_CLASSIC,
    borderColor: MMD_GOLD_CLASSIC,
  },
  chipLabel: {
    color: "rgba(248,250,252,0.7)",
    fontSize: 14,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  chipLabelActive: { color: MMD_BLUE },
  list: { padding: 16, gap: 14, paddingBottom: 24 },
  emptyFilter: {
    color: "rgba(255,255,255,0.6)",
    textAlign: "center",
    marginTop: 24,
    fontFamily: MMD_FONT.regular,
  },
  card: { borderRadius: 22, gap: 8 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  orderId: {
    color: MMD_WHITE,
    fontSize: 17,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  pill: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 12, fontFamily: MMD_FONT.semibold, fontWeight: "600" },
  amount: {
    color: MMD_WHITE,
    fontSize: 24,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  meta: {
    color: "rgba(248,250,252,0.6)",
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
  },
  refund: { color: "#F59E0B", fontSize: 12 },
  notes: { color: "rgba(255,255,255,0.7)", fontSize: 13 },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  actionLabel: {
    color: MMD_WHITE,
    fontWeight: "600",
    fontFamily: MMD_FONT.semibold,
    textTransform: "capitalize",
  },
});
