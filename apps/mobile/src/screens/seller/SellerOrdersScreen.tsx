import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  AppState,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { loadOwnSeller, loadSellerOrders } from "../../lib/sellerApi";
import { formatMoney, type SellerOrderRow } from "../../lib/sellerTypes";
import { updateMarketplaceSellerOrderStatus } from "../../lib/marketplaceApi";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import { UiEmptyState, UiLoadingState } from "../../components/ui/UiStates";
import { toUserFacingError } from "../../lib/userFacingError";
import { rowDirection } from "../../i18n/rtl";
import {
  subscribePostgresChannel,
  unsubscribeSupabaseChannel,
} from "../../lib/supabaseRealtime";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { MARKETPLACE_LIST_PERF } from "../../lib/listPerf";
import { APP_COLORS } from "../../theme/appTheme";

type Props = { navigation: any };

export default function SellerOrdersScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [orders, setOrders] = useState<SellerOrderRow[]>([]);
  const [sellerId, setSellerId] = useState<string | null>(null);
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

  const actionsFor = useMemo(
    () =>
      (status: string): Array<"accepted" | "refused" | "preparing" | "ready"> => {
        if (status === "paid" || status === "confirmed") return ["accepted", "refused"];
        if (status === "accepted") return ["preparing"];
        if (status === "preparing") return ["ready"];
        return [];
      },
    []
  );

  async function applyStatus(
    order: SellerOrderRow,
    status: "accepted" | "refused" | "preparing" | "ready"
  ) {
    try {
      setBusyId(order.id);
      const result = await updateMarketplaceSellerOrderStatus({
        orderId: order.id,
        status,
      });
      if (result.stripe_refund_deferred) {
        Alert.alert(
          t("seller.orders.refundDeferredTitle", "Refund deferred"),
          result.message ??
            t(
              "seller.orders.refundDeferredBody",
              "Order refused. Full refund is marked required — Stripe refund is not executed yet."
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: APP_COLORS.bg }} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("seller.orders.title", "Marketplace Orders")}
        subtitle={t(
          "seller.orders.lifecycleHint",
          "Accept and prepare paid orders. Live payouts stay off."
        )}
        fallbackRoute="SellerDashboard"
        variant="dark"
      />

      {loading ? (
        <UiLoadingState />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          {...MARKETPLACE_LIST_PERF}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          ListEmptyComponent={
            <UiEmptyState
              title={t("seller.orders.empty", "No marketplace orders yet.")}
              style={{ marginTop: 24 }}
            />
          }
          renderItem={({ item }) => {
            const actions = actionsFor(item.status);
            return (
              <View
                style={{
                  backgroundColor: APP_COLORS.surface,
                  borderRadius: 14,
                  padding: 14,
                  borderWidth: 1,
                  borderColor: APP_COLORS.border,
                  gap: 8,
                }}
              >
                <Text style={{ color: APP_COLORS.text, fontWeight: "700" }}>
                  #{item.id.slice(0, 8)} · {item.status}
                </Text>
                <Text style={{ color: APP_COLORS.textMuted }}>
                  {formatMoney(item.total_cents, item.currency)}
                </Text>
                {item.refund_status ? (
                  <Text style={{ color: APP_COLORS.warning, fontSize: 12 }}>
                    {t("seller.orders.refundStatus", "Refund")}: {item.refund_status}
                  </Text>
                ) : null}
                {item.notes ? (
                  <Text style={{ color: APP_COLORS.textSubtle }}>{item.notes}</Text>
                ) : null}
                {actions.length > 0 ? (
                  <View style={{ flexDirection: rowDirection(), flexWrap: "wrap", gap: 8 }}>
                    {actions.map((action) => (
                      <TouchableOpacity
                        key={action}
                        disabled={busyId === item.id}
                        onPress={() => void applyStatus(item, action)}
                        style={{
                          backgroundColor: action === "refused" ? APP_COLORS.dangerStrong : "#4C1D95",
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          borderRadius: 8,
                          opacity: busyId === item.id ? 0.6 : 1,
                        }}
                      >
                        <Text style={{ color: APP_COLORS.onAccent, fontWeight: "600", textTransform: "capitalize" }}>
                          {action === "accepted"
                            ? t("seller.orders.accept", "Accept")
                            : action === "refused"
                              ? t("seller.orders.refuse", "Refuse")
                              : action === "preparing"
                                ? t("seller.orders.preparing", "Preparing")
                                : t("seller.orders.ready", "Ready")}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}
