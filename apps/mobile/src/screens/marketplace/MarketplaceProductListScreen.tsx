import React, { useCallback, useEffect, useState } from "react";
import {
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import {
  fetchMarketplaceProducts,
  formatMarketplaceMoney,
  type MarketplaceProduct,
} from "../../lib/marketplaceApi";
import { useTranslation } from "react-i18next";

type Props = NativeStackScreenProps<RootStackParamList, "MarketplaceProductList">;

export default function MarketplaceProductListScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { sellerId, sellerName, sellerCountryCode, sellerIsOpen = true } = route.params;
  const scope = { sellerCountryCode };
  const [products, setProducts] = useState<MarketplaceProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError(null);
      setProducts(await fetchMarketplaceProducts(sellerId, scope));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load products");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [sellerCountryCode, sellerId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={sellerName}
        subtitle={t("marketplace.products.subtitle", "Browse active products")}
        fallbackRoute="MarketplaceHome"
        variant="dark"
      />
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} />
        }
        contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 12 }}
      >
        {!sellerIsOpen ? (
          <Text style={{ color: "#FCA5A5", marginBottom: 8 }}>
            {t("marketplace.products.shopClosed", "This shop is currently closed.")}
          </Text>
        ) : null}

        <TouchableOpacity
          disabled={!sellerIsOpen}
          onPress={() =>
            navigation.navigate("MarketplaceCart", {
              sellerId,
              sellerName,
              sellerCountryCode,
            })
          }
          style={{
            alignSelf: "flex-start",
            backgroundColor: "#6D28D9",
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 10,
            marginBottom: 8,
            opacity: sellerIsOpen ? 1 : 0.5,
          }}
        >
          <Text style={{ color: "#FFF" }}>
            {t("marketplace.products.openCart", "Open cart / draft")}
          </Text>
        </TouchableOpacity>

        {loading ? (
          <ActivityIndicator color="#A78BFA" />
        ) : error ? (
          <Text style={{ color: "#FCA5A5" }}>{error}</Text>
        ) : products.length === 0 ? (
          <Text style={{ color: "#CBD5E1" }}>
            {t("marketplace.products.empty", "No active products.")}
          </Text>
        ) : (
          products.map((product) => (
            <TouchableOpacity
              key={product.id}
              disabled={!sellerIsOpen}
              onPress={() =>
                navigation.navigate("MarketplaceProductDetails", {
                  sellerId,
                  sellerName,
                  sellerCountryCode,
                  productId: product.id,
                })
              }
              style={{
                borderWidth: 1,
                borderColor: "#334155",
                borderRadius: 14,
                padding: 14,
                backgroundColor: "#111827",
              }}
            >
              <Text style={{ color: "#F8FAFC", fontSize: 17, fontWeight: "600" }}>
                {product.title}
              </Text>
              <Text style={{ color: "#94A3B8", marginTop: 4 }} numberOfLines={2}>
                {product.description || product.category}
              </Text>
              <Text style={{ color: "#C4B5FD", marginTop: 8 }}>
                {formatMarketplaceMoney(product.price_cents, product.currency)}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
