import React, { useCallback, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { loadOwnSeller, loadSellerOrders } from "../../lib/sellerApi";
import { formatMoney, type SellerOrderRow } from "../../lib/sellerTypes";
import { useTranslation } from "react-i18next";

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
    <SafeAreaView style={{ flex: 1, backgroundColor: "#030712" }}>
      <View style={{ padding: 16 }}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ color: "#A78BFA" }}>{t("common.back", "Back")}</Text>
        </TouchableOpacity>
        <Text style={{ color: "#F8FAFC", fontSize: 22, fontWeight: "800", marginTop: 8 }}>
          {t("seller.orders.title", "Marketplace Orders")}
        </Text>
        <Text style={{ color: "#94A3B8", marginTop: 4 }}>
          {t("seller.orders.readOnly", "Read-only preview — checkout not live yet.")}
        </Text>
      </View>

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
