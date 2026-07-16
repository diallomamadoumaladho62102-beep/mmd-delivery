import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import {
  addMarketplaceFavorite,
  fetchMarketplaceFavorites,
  fetchMarketplaceProducts,
  formatMarketplaceMoney,
  removeMarketplaceFavorite,
  type MarketplaceProduct,
} from "../../lib/marketplaceApi";
import { useTranslation } from "react-i18next";

type Props = NativeStackScreenProps<RootStackParamList, "MarketplaceProductList">;

export default function MarketplaceProductListScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { sellerId, sellerName, sellerCountryCode, sellerIsOpen = true } =
    route.params ?? ({} as typeof route.params);
  const scope = { sellerCountryCode };
  const [products, setProducts] = useState<MarketplaceProduct[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError(null);
      const [items, favorites] = await Promise.all([
        fetchMarketplaceProducts(sellerId, scope),
        fetchMarketplaceFavorites(scope, sellerId).catch(() => []),
      ]);
      setProducts(items);
      setFavoriteIds(new Set(favorites.map((row) => row.product_id)));
    } catch (e) {
      setError(toUserFacingError(e, "Unable to load products"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [sellerCountryCode, sellerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => {
    const set = new Set(
      products.map((product) => String(product.category || "general").trim() || "general")
    );
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((product) => {
      if (categoryFilter && product.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        product.title.toLowerCase().includes(q) ||
        String(product.category ?? "")
          .toLowerCase()
          .includes(q) ||
        String(product.description ?? "")
          .toLowerCase()
          .includes(q)
      );
    });
  }, [products, search, categoryFilter]);

  async function toggleFavorite(product: MarketplaceProduct) {
    const isFav = favoriteIds.has(product.id);
    try {
      if (isFav) {
        await removeMarketplaceFavorite({ productId: product.id, sellerCountryCode });
        setFavoriteIds((prev) => {
          const next = new Set(prev);
          next.delete(product.id);
          return next;
        });
      } else {
        await addMarketplaceFavorite({
          productId: product.id,
          sellerId,
          sellerCountryCode,
        });
        setFavoriteIds((prev) => new Set(prev).add(product.id));
      }
    } catch (e) {
      setError(toUserFacingError(e, "Unable to update favorite"));
    }
  }

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

        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t("marketplace.products.search", "Search products")}
          placeholderTextColor="#64748B"
          style={{
            backgroundColor: "#111827",
            borderWidth: 1,
            borderColor: "#334155",
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 12,
            color: "#F8FAFC",
          }}
        />

        {categories.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity
                onPress={() => setCategoryFilter(null)}
                style={{
                  backgroundColor: categoryFilter == null ? "#7C3AED" : "#1F2937",
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                }}
              >
                <Text style={{ color: "#F8FAFC", fontSize: 12 }}>
                  {t("marketplace.products.allCategories", "All")}
                </Text>
              </TouchableOpacity>
              {categories.map((category) => (
                <TouchableOpacity
                  key={category}
                  onPress={() => setCategoryFilter(category)}
                  style={{
                    backgroundColor: categoryFilter === category ? "#7C3AED" : "#1F2937",
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 999,
                  }}
                >
                  <Text style={{ color: "#F8FAFC", fontSize: 12 }}>{category}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
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
        ) : filtered.length === 0 ? (
          <Text style={{ color: "#CBD5E1" }}>
            {t("marketplace.products.empty", "No active products.")}
          </Text>
        ) : (
          filtered.map((product) => (
            <View
              key={product.id}
              style={{
                borderWidth: 1,
                borderColor: "#334155",
                borderRadius: 14,
                padding: 14,
                backgroundColor: "#111827",
                gap: 8,
              }}
            >
              <TouchableOpacity
                disabled={!sellerIsOpen}
                onPress={() =>
                  navigation.navigate("MarketplaceProductDetails", {
                    sellerId,
                    sellerName,
                    sellerCountryCode,
                    productId: product.id,
                  })
                }
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
              <TouchableOpacity onPress={() => void toggleFavorite(product)}>
                <Text style={{ color: favoriteIds.has(product.id) ? "#FCD34D" : "#94A3B8" }}>
                  {favoriteIds.has(product.id)
                    ? t("marketplace.products.favorited", "★ Favorited")
                    : t("marketplace.products.favorite", "☆ Favorite")}
                </Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
