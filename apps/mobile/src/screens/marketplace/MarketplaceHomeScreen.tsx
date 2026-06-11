import React, { useCallback, useEffect, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import {
  fetchMarketplaceSellers,
  type MarketplaceSeller,
} from "../../lib/marketplaceApi";
import { useTranslation } from "react-i18next";

type Nav = NativeStackNavigationProp<RootStackParamList, "MarketplaceHome">;

export default function MarketplaceHomeScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const [sellers, setSellers] = useState<MarketplaceSeller[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError(null);
      const items = await fetchMarketplaceSellers();
      setSellers(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load marketplace");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} />
        }
        contentContainerStyle={{ padding: 20, gap: 12 }}
      >
        <Text style={{ color: "#F8FAFC", fontSize: 28, fontWeight: "700" }}>
          {t("marketplace.home.title", "Marketplace")}
        </Text>
        <Text style={{ color: "#94A3B8", marginBottom: 8 }}>
          {t("marketplace.home.subtitle", "Shop approved local sellers on MMD.")}
        </Text>

        <TouchableOpacity
          onPress={() => navigation.navigate("SellerGate" as never)}
          style={{ alignSelf: "flex-start", marginBottom: 8 }}
        >
          <Text style={{ color: "#A78BFA" }}>
            {t("marketplace.home.sellCta", "Sell on MMD →")}
          </Text>
        </TouchableOpacity>

        {loading ? (
          <ActivityIndicator color="#A78BFA" />
        ) : error ? (
          <Text style={{ color: "#FCA5A5" }}>{error}</Text>
        ) : sellers.length === 0 ? (
          <Text style={{ color: "#CBD5E1" }}>
            {t("marketplace.home.empty", "No approved sellers yet.")}
          </Text>
        ) : (
          sellers.map((seller) => (
            <TouchableOpacity
              key={seller.id}
              onPress={() =>
                navigation.navigate("MarketplaceProductList", {
                  sellerId: seller.id,
                  sellerName: seller.business_name,
                  sellerCountryCode: seller.country_code,
                })
              }
              style={{
                backgroundColor: "rgba(124,58,237,0.15)",
                borderColor: "rgba(196,181,253,0.25)",
                borderWidth: 1,
                borderRadius: 16,
                padding: 16,
              }}
            >
              <Text style={{ color: "#F8FAFC", fontSize: 18, fontWeight: "600" }}>
                {seller.business_name}
              </Text>
              <Text style={{ color: "#CBD5E1", marginTop: 4 }}>
                {seller.city}, {seller.country_code}
              </Text>
              <Text style={{ color: "#94A3B8", marginTop: 4 }} numberOfLines={2}>
                {seller.address}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
