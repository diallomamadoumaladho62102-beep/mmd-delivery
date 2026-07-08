import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { loadOwnSeller, loadSellerOrders } from "../../lib/sellerApi";
import { formatMoney, type SellerOrderRow } from "../../lib/sellerTypes";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../../components/navigation/ScreenHeader";

type Props = { navigation: any };

export default function SellerOrdersScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<SellerOrderRow[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const seller = await loadOwnSeller();
      if (!seller) {
        navigation.replace("SellerOnboarding");
        return;
      }
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#030712" }} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("seller.orders.title", "Marketplace Orders")}
        subtitle={t("seller.orders.readOnly", "Read-only preview — checkout not live yet.")}
        fallbackRoute="SellerDashboard"
        variant="dark"
      />

      {loading ? (
        <ActivityIndicator color="#A78BFA" />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          ListEmptyComponent={
            <Text style={{ color: "#94A3B8", textAlign: "center", marginTop: 24 }}>
              {t("seller.orders.empty", "No marketplace orders yet.")}
            </Text>
          }
          renderItem={({ item }) => (
            <View
              style={{
                backgroundColor: "#111827",
                borderRadius: 14,
                padding: 14,
                borderWidth: 1,
                borderColor: "#1F2937",
              }}
            >
              <Text style={{ color: "#F8FAFC", fontWeight: "700" }}>
                #{item.id.slice(0, 8)} · {item.status}
              </Text>
              <Text style={{ color: "#94A3B8", marginTop: 4 }}>
                {formatMoney(item.total_cents, item.currency)}
              </Text>
              <Text style={{ color: "#64748B", marginTop: 6, fontSize: 12 }}>
                {t("seller.orders.deliveryNotLive", "Delivery not live yet")}
              </Text>
              {item.delivery_status_shadow &&
              item.delivery_status_shadow !== "not_started" ? (
                <>
                  <Text style={{ color: "#A78BFA", marginTop: 4, fontSize: 12 }}>
                    {t("seller.orders.deliveryShadowStatus", "Delivery shadow")}:{" "}
                    {item.delivery_status_shadow}
                  </Text>
                  {item.estimated_distance_miles != null ? (
                    <Text style={{ color: "#CBD5E1", marginTop: 2, fontSize: 12 }}>
                      {t("seller.orders.estimatedDelivery", "Est. delivery")}:{" "}
                      {Number(item.estimated_distance_miles).toFixed(1)} mi ·{" "}
                      {Math.round(Number(item.estimated_minutes ?? 0))} min
                    </Text>
                  ) : null}
                </>
              ) : null}
              {item.notes ? (
                <Text style={{ color: "#CBD5E1", marginTop: 4 }}>{item.notes}</Text>
              ) : null}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}
