import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  View,
  StatusBar,
  StyleSheet,
  Image,
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
import { MarketplaceBrandState } from "../../components/marketplace/MarketplaceBrandState";
import { MARKETPLACE_LIST_PERF } from "../../lib/listPerf";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_LINK_BLUE,
  MMD_STROKE,
  MMD_TEXT,
  MMD_TEXT_MUTED_BLUE,
  MMD_WHITE,
} from "../../theme/mmdUi";

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

  const listHeader = (
    <View style={styles.headerBlock}>
      {!sellerIsOpen ? (
        <View style={styles.closedBanner}>
          <Text style={styles.closedBannerText}>
            {t("marketplace.products.shopClosed", "This shop is currently closed.")}
          </Text>
        </View>
      ) : null}

      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder={t("marketplace.products.search", "Search products")}
        placeholderTextColor={MMD_TEXT_MUTED_BLUE}
        style={styles.search}
      />

      {categories.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chips}>
            <TouchableOpacity
              onPress={() => setCategoryFilter(null)}
              style={[
                styles.chip,
                categoryFilter == null ? styles.chipActive : styles.chipIdle,
              ]}
            >
              <Text
                style={
                  categoryFilter == null ? styles.chipActiveText : styles.chipIdleText
                }
              >
                {t("marketplace.products.allCategories", "All")}
              </Text>
            </TouchableOpacity>
            {categories.map((category) => (
              <TouchableOpacity
                key={category}
                onPress={() => setCategoryFilter(category)}
                style={[
                  styles.chip,
                  categoryFilter === category ? styles.chipActive : styles.chipIdle,
                ]}
              >
                <Text
                  style={
                    categoryFilter === category
                      ? styles.chipActiveText
                      : styles.chipIdleText
                  }
                >
                  {category}
                </Text>
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
        style={[styles.cartBtn, { opacity: sellerIsOpen ? 1 : 0.55 }]}
      >
        <Text style={styles.cartBtnText}>
          {t("marketplace.products.openCart", "Open cart / draft")}
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={sellerName}
        subtitle={t("marketplace.products.subtitle", "Browse active products")}
        fallbackRoute="MarketplaceHome"
        variant="mmd"
      />
      <FlatList
        data={loading || error ? [] : filtered}
        keyExtractor={(item) => item.id}
        {...MARKETPLACE_LIST_PERF}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load(true);
            }}
            tintColor={MMD_LINK_BLUE}
          />
        }
        contentContainerStyle={styles.list}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          loading ? (
            <MarketplaceBrandState
              mode="loading"
              message={t("marketplace.products.loading", "Loading products...")}
            />
          ) : error ? (
            <MarketplaceBrandState
              mode="error"
              title={t("marketplace.products.errorTitle", "Couldn’t load products")}
              message={error}
              onRetry={() => void load()}
              retryLabel={t("common.retry", "Retry")}
            />
          ) : (
            <MarketplaceBrandState
              mode="empty"
              title={t("marketplace.products.empty", "No active products.")}
              message={t(
                "marketplace.products.emptyHint",
                "Try another category or check back later."
              )}
            />
          )
        }
        renderItem={({ item: product }) => {
          const imageUrl = String(product.image_paths?.[0] ?? "").trim();
          return (
            <View style={styles.productCard}>
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
                style={styles.productTextCol}
              >
                {imageUrl ? (
                  <Image
                    source={{ uri: imageUrl }}
                    style={styles.productImage}
                    resizeMode="cover"
                    accessibilityLabel={product.title}
                  />
                ) : null}
                <Text style={styles.productTitle}>{product.title}</Text>
                <Text style={styles.productDesc} numberOfLines={2}>
                  {product.description || product.category}
                </Text>
                <Text style={styles.productPrice}>
                  {formatMarketplaceMoney(product.price_cents, product.currency)}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => void toggleFavorite(product)}>
                <Text style={styles.favorite}>
                  {favoriteIds.has(product.id)
                    ? t("marketplace.products.favorited", "★ Favorited")
                    : t("marketplace.products.favorite", "☆ Favorite")}
                </Text>
              </TouchableOpacity>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  list: { padding: 20, paddingTop: 8, gap: 12 },
  headerBlock: { gap: 12, marginBottom: 12 },
  closedBanner: {
    backgroundColor: "rgba(239,68,68,0.14)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.35)",
    borderRadius: 10,
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 10,
    justifyContent: "center",
  },
  closedBannerText: {
    color: "#F87171",
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 13,
  },
  search: {
    height: 42,
    borderWidth: 1,
    borderColor: "#0037A0",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: MMD_WHITE,
    fontFamily: MMD_FONT.regular,
    fontSize: 14,
  },
  chips: { flexDirection: "row", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipActive: {
    backgroundColor: "#22C55E",
    borderColor: "#22C55E",
  },
  chipIdle: {
    backgroundColor: MMD_WHITE,
    borderColor: "#E2E8F0",
  },
  chipActiveText: {
    color: MMD_BLUE,
    fontFamily: MMD_FONT.extrabold,
    fontSize: 13,
    fontWeight: "800",
  },
  chipIdleText: {
    color: "#0037A0",
    fontFamily: MMD_FONT.extrabold,
    fontSize: 13,
    fontWeight: "800",
  },
  cartBtn: {
    alignSelf: "flex-start",
    backgroundColor: MMD_LINK_BLUE,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    justifyContent: "center",
  },
  cartBtnText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontSize: 14,
    fontWeight: "600",
  },
  productCard: {
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    borderRadius: 14,
    padding: 14,
    backgroundColor: MMD_BLUE,
    gap: 8,
  },
  productImage: {
    width: "100%",
    height: 140,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginBottom: 4,
  },
  productTextCol: {
    width: "100%",
    gap: 8,
  },
  productTitle: {
    color: MMD_TEXT,
    fontSize: 17,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  productDesc: {
    color: MMD_TEXT_MUTED_BLUE,
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
  },
  productPrice: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.semibold,
    fontSize: 14,
    fontWeight: "600",
  },
  favorite: {
    color: MMD_TEXT_MUTED_BLUE,
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
  },
});
