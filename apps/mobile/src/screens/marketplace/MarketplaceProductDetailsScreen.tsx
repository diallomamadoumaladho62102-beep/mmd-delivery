import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import {
  addMarketplaceFavorite,
  fetchMarketplaceDraft,
  fetchMarketplaceFavorites,
  fetchMarketplaceProducts,
  formatMarketplaceMoney,
  removeMarketplaceFavorite,
  saveMarketplaceDraft,
  type MarketplaceProduct,
} from "../../lib/marketplaceApi";
import { useTranslation } from "react-i18next";
import { rowDirection } from "../../i18n/rtl";

type Props = NativeStackScreenProps<RootStackParamList, "MarketplaceProductDetails">;

export default function MarketplaceProductDetailsScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { sellerId, sellerName, productId, sellerCountryCode, orderId: routeOrderId } =
    route.params ?? ({} as typeof route.params);
  const scope = { sellerCountryCode };
  const [product, setProduct] = useState<MarketplaceProduct | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draftOrderId, setDraftOrderId] = useState<string | undefined>(routeOrderId);
  const [favorited, setFavorited] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [products, draft, favorites] = await Promise.all([
        fetchMarketplaceProducts(sellerId, scope),
        fetchMarketplaceDraft({ sellerId, orderId: routeOrderId }, scope).catch(() => null),
        fetchMarketplaceFavorites(scope, sellerId).catch(() => []),
      ]);
      setProduct(products.find((row) => row.id === productId) ?? null);
      if (draft?.id) setDraftOrderId(draft.id);
      setFavorited(favorites.some((row) => row.product_id === productId));
    } finally {
      setLoading(false);
    }
  }, [productId, routeOrderId, sellerCountryCode, sellerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalLabel = useMemo(() => {
    if (!product) return "";
    const unit =
      product.promo_price_cents != null && product.promo_price_cents < product.price_cents
        ? product.promo_price_cents
        : product.price_cents;
    return formatMarketplaceMoney(unit * quantity, product.currency);
  }, [product, quantity]);

  async function addToDraft() {
    if (!product) return;
    try {
      setSaving(true);
      let orderId = draftOrderId;
      if (!orderId) {
        const existing = await fetchMarketplaceDraft({ sellerId }, scope).catch(() => null);
        orderId = existing?.id;
      }
      const order = await saveMarketplaceDraft({
        sellerId,
        sellerCountryCode,
        orderId,
        items: [{ product_id: product.id, quantity }],
      });
      setDraftOrderId(order.id);
      Alert.alert(
        t("marketplace.details.addedTitle", "Added to draft"),
        t("marketplace.details.addedBody", "Your marketplace draft was updated.")
      );
      navigation.navigate("MarketplaceCart", {
        sellerId,
        sellerName,
        sellerCountryCode,
        orderId: order.id,
      });
    } catch (e) {
      Alert.alert(
        t("marketplace.details.errorTitle", "Unable to update draft"),
        toUserFacingError(e, "Unknown error")
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleFavorite() {
    if (!product) return;
    try {
      setFavoriteBusy(true);
      if (favorited) {
        await removeMarketplaceFavorite({ productId: product.id, sellerCountryCode });
        setFavorited(false);
      } else {
        await addMarketplaceFavorite({
          productId: product.id,
          sellerId,
          sellerCountryCode,
        });
        setFavorited(true);
      }
    } catch (e) {
      Alert.alert(
        t("marketplace.details.errorTitle", "Unable to update draft"),
        toUserFacingError(e, "Unknown error")
      );
    } finally {
      setFavoriteBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={product?.title ?? t("marketplace.details.title", "Product")}
        fallbackRoute="MarketplaceHome"
        variant="dark"
      />
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 16 }}>
        {loading ? (
          <ActivityIndicator color="#A78BFA" />
        ) : !product ? (
          <Text style={{ color: "#FCA5A5" }}>
            {t("marketplace.details.notFound", "Product not found.")}
          </Text>
        ) : (
          <>
            <Text style={{ color: "#CBD5E1" }}>{product.description}</Text>
            <Text style={{ color: "#C4B5FD", fontSize: 18 }}>
              {formatMarketplaceMoney(
                product.promo_price_cents != null &&
                  product.promo_price_cents < product.price_cents
                  ? product.promo_price_cents
                  : product.price_cents,
                product.currency
              )}
            </Text>
            {product.stock_qty != null ? (
              <Text style={{ color: "#94A3B8" }}>
                {t("marketplace.details.stock", "Stock")}: {product.stock_qty}
              </Text>
            ) : null}

            <View style={{ flexDirection: rowDirection(), alignItems: "center", gap: 12 }}>
              <Text style={{ color: "#94A3B8" }}>
                {t("marketplace.details.quantity", "Quantity")}
              </Text>
              <TouchableOpacity
                onPress={() => setQuantity((value) => Math.max(1, value - 1))}
                style={qtyButtonStyle}
              >
                <Text style={{ color: "#FFF", fontSize: 18 }}>-</Text>
              </TouchableOpacity>
              <Text style={{ color: "#F8FAFC", fontSize: 18, minWidth: 28, textAlign: "center" }}>
                {quantity}
              </Text>
              <TouchableOpacity
                onPress={() => setQuantity((value) => value + 1)}
                style={qtyButtonStyle}
              >
                <Text style={{ color: "#FFF", fontSize: 18 }}>+</Text>
              </TouchableOpacity>
            </View>

            <Text style={{ color: "#94A3B8" }}>
              {t("marketplace.details.lineTotal", "Line total")}: {totalLabel}
            </Text>

            <TouchableOpacity
              disabled={favoriteBusy}
              onPress={() => void toggleFavorite()}
              style={{
                backgroundColor: favorited ? "#334155" : "#1E293B",
                padding: 12,
                borderRadius: 12,
                alignItems: "center",
                opacity: favoriteBusy ? 0.7 : 1,
              }}
            >
              <Text style={{ color: "#E2E8F0", fontWeight: "600" }}>
                {favorited
                  ? t("marketplace.details.unfavorite", "Remove favorite")
                  : t("marketplace.details.favorite", "Add to favorites")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              disabled={saving}
              onPress={() => void addToDraft()}
              style={{
                backgroundColor: "#6D28D9",
                padding: 14,
                borderRadius: 12,
                alignItems: "center",
                opacity: saving ? 0.7 : 1,
              }}
            >
              <Text style={{ color: "#FFF", fontWeight: "600" }}>
                {saving
                  ? t("marketplace.details.saving", "Saving draft…")
                  : t("marketplace.details.addToDraft", "Add to draft cart")}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const qtyButtonStyle = {
  backgroundColor: "#334155",
  width: 36,
  height: 36,
  borderRadius: 8,
  alignItems: "center" as const,
  justifyContent: "center" as const,
};
