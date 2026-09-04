import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  StatusBar,
  StyleSheet,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import { MarketplaceBrandState } from "../../components/marketplace/MarketplaceBrandState";
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
import { supabase } from "../../lib/supabase";
import {
  CLIENT_SCREEN_FETCH_TIMEOUT_MS,
  withTimeout,
} from "../../lib/bootFailOpen";
import { useTranslation } from "react-i18next";
import { rowDirection } from "../../i18n/rtl";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_STROKE,
  MMD_TEXT,
  MMD_TEXT_MUTED_BLUE,
  MMD_WHITE,
} from "../../theme/mmdUi";

type Props = NativeStackScreenProps<RootStackParamList, "MarketplaceProductDetails">;

const MMD_CYAN = "#00C0E8";

async function hasClientSession(): Promise<boolean> {
  const { data } = await withTimeout(
    supabase.auth.getSession(),
    CLIENT_SCREEN_FETCH_TIMEOUT_MS,
    "marketplace_product_details_session",
  );
  return Boolean(data.session?.access_token);
}

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
  const [isGuest, setIsGuest] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const signedIn = await hasClientSession();
      setIsGuest(!signedIn);

      const products = await fetchMarketplaceProducts(sellerId, scope);
      setProduct(products.find((row) => row.id === productId) ?? null);

      if (!signedIn) {
        setDraftOrderId(undefined);
        setFavorited(false);
        return;
      }

      const [draft, favorites] = await Promise.all([
        fetchMarketplaceDraft({ sellerId, orderId: routeOrderId }, scope).catch(() => null),
        fetchMarketplaceFavorites(scope, sellerId).catch(() => []),
      ]);
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

  function promptSignIn(actionLabel: string) {
    Alert.alert(
      t("marketplace.details.signInTitle", "Sign in required"),
      t(
        "marketplace.details.signInBody",
        "Create an account or sign in to {{action}}. You can keep browsing products without an account.",
        { action: actionLabel },
      ),
      [
        { text: t("common.cancel", "Cancel"), style: "cancel" },
        {
          text: t("marketplace.details.signInCta", "Sign in"),
          onPress: () => navigation.navigate("ClientAuth" as never),
        },
      ],
    );
  }

  async function addToDraft() {
    if (!product) return;
    if (!(await hasClientSession())) {
      promptSignIn(t("marketplace.details.addToCartAction", "add items to your cart"));
      return;
    }
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
        toUserFacingError(e, t("common.unknownError", "Unknown error."))
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleFavorite() {
    if (!product) return;
    if (!(await hasClientSession())) {
      promptSignIn(t("marketplace.details.favoriteAction", "save favorites"));
      return;
    }
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
        toUserFacingError(e, t("common.unknownError", "Unknown error."))
      );
    } finally {
      setFavoriteBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={product?.title ?? t("marketplace.details.title", "Product")}
        fallbackRoute="MarketplaceHome"
        variant="mmd"
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? (
          <MarketplaceBrandState
            mode="loading"
            message={t("marketplace.details.loading", "Loading product...")}
          />
        ) : !product ? (
          <MarketplaceBrandState
            mode="error"
            title={t("marketplace.details.notFound", "Product not found.")}
            message={t(
              "marketplace.details.notFoundHint",
              "This product may no longer be available."
            )}
            onRetry={() => void load()}
            retryLabel={t("common.retry", "Retry")}
          />
        ) : (
          <>
            {isGuest ? (
              <Text style={styles.guestBanner}>
                {t(
                  "marketplace.details.guestBanner",
                  "Browsing as guest — sign in to order.",
                )}
              </Text>
            ) : null}
            {String(product.image_paths?.[0] ?? "").trim() ? (
              <Image
                source={{ uri: String(product.image_paths?.[0]).trim() }}
                style={styles.heroImage}
                resizeMode="cover"
                accessibilityLabel={product.title}
              />
            ) : null}
            <Text style={styles.description}>{product.description}</Text>
            <Text style={styles.price}>
              {formatMarketplaceMoney(
                product.promo_price_cents != null &&
                  product.promo_price_cents < product.price_cents
                  ? product.promo_price_cents
                  : product.price_cents,
                product.currency
              )}
            </Text>
            {product.stock_qty != null ? (
              <Text style={styles.stock}>
                {t("marketplace.details.stock", "Stock")}: {product.stock_qty}
              </Text>
            ) : null}

            <View style={[styles.qtyRow, { flexDirection: rowDirection() }]}>
              <Text style={styles.qtyLabel}>
                {t("marketplace.details.quantity", "Quantity")}
              </Text>
              <TouchableOpacity
                onPress={() => setQuantity((value) => Math.max(1, value - 1))}
                style={styles.qtyBtn}
              >
                <Text style={styles.qtyBtnText}>-</Text>
              </TouchableOpacity>
              <Text style={styles.qtyValue}>{quantity}</Text>
              <TouchableOpacity
                onPress={() => setQuantity((value) => value + 1)}
                style={styles.qtyBtn}
              >
                <Text style={styles.qtyBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.lineTotal}>
              {t("marketplace.details.lineTotal", "Line total")}: {totalLabel}
            </Text>

            <TouchableOpacity
              disabled={favoriteBusy}
              onPress={() => void toggleFavorite()}
              style={[styles.favBtn, { opacity: favoriteBusy ? 0.7 : 1 }]}
            >
              <Text style={styles.favBtnText}>
                {favorited
                  ? t("marketplace.details.unfavorite", "Remove favorite")
                  : t("marketplace.details.favorite", "Add to favorites")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              disabled={saving}
              onPress={() => void addToDraft()}
              style={[styles.cartBtn, { opacity: saving ? 0.7 : 1 }]}
            >
              <Text style={styles.cartBtnText}>
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  scroll: { padding: 20, paddingTop: 8, gap: 16 },
  guestBanner: {
    color: "#CBD5E1",
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  heroImage: {
    width: "100%",
    height: 200,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  description: {
    color: "#CBD5E1",
    fontFamily: MMD_FONT.regular,
    fontSize: 14,
  },
  price: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.semibold,
    fontSize: 18,
    fontWeight: "600",
  },
  stock: {
    color: MMD_TEXT_MUTED_BLUE,
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
  },
  qtyRow: { alignItems: "center", gap: 12 },
  qtyLabel: {
    color: MMD_TEXT_MUTED_BLUE,
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
    width: 58,
  },
  qtyBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: MMD_STROKE,
    backgroundColor: "#0037A0",
    alignItems: "center",
    justifyContent: "center",
  },
  qtyBtnText: {
    color: MMD_WHITE,
    fontSize: 18,
    fontFamily: MMD_FONT.regular,
  },
  qtyValue: {
    color: MMD_TEXT,
    fontSize: 18,
    minWidth: 28,
    textAlign: "center",
    fontFamily: MMD_FONT.regular,
  },
  lineTotal: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
  },
  favBtn: {
    backgroundColor: "#002B8C",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.5)",
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  favBtnText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontSize: 14,
    fontWeight: "600",
  },
  cartBtn: {
    backgroundColor: MMD_CYAN,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cartBtnText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontSize: 14,
    fontWeight: "600",
  },
});
