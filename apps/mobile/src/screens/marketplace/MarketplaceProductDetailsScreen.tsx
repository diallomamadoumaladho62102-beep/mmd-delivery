import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import {
  fetchMarketplaceProducts,
  formatMarketplaceMoney,
  saveMarketplaceDraft,
  type MarketplaceProduct,
} from "../../lib/marketplaceApi";
import { useTranslation } from "react-i18next";

type Props = NativeStackScreenProps<RootStackParamList, "MarketplaceProductDetails">;

export default function MarketplaceProductDetailsScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { sellerId, sellerName, productId } = route.params;
  const [product, setProduct] = useState<MarketplaceProduct | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const products = await fetchMarketplaceProducts(sellerId);
      setProduct(products.find((row) => row.id === productId) ?? null);
    } finally {
      setLoading(false);
    }
  }, [productId, sellerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalLabel = useMemo(() => {
    if (!product) return "";
    return formatMarketplaceMoney(product.price_cents * quantity, product.currency);
  }, [product, quantity]);

  async function addToDraft() {
    if (!product) return;
    try {
      setSaving(true);
      const order = await saveMarketplaceDraft({
        sellerId,
        items: [{ product_id: product.id, quantity }],
      });
      Alert.alert(
        t("marketplace.details.addedTitle", "Added to draft"),
        t("marketplace.details.addedBody", "Your marketplace draft was updated.")
      );
      navigation.navigate("MarketplaceCart", {
        sellerId,
        sellerName,
        orderId: order.id,
      });
    } catch (e) {
      Alert.alert(
        t("marketplace.details.errorTitle", "Unable to update draft"),
        e instanceof Error ? e.message : "Unknown error"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        {loading ? (
          <ActivityIndicator color="#A78BFA" />
        ) : !product ? (
          <Text style={{ color: "#FCA5A5" }}>
            {t("marketplace.details.notFound", "Product not found.")}
          </Text>
        ) : (
          <>
            <Text style={{ color: "#F8FAFC", fontSize: 26, fontWeight: "700" }}>
              {product.title}
            </Text>
            <Text style={{ color: "#CBD5E1" }}>{product.description}</Text>
            <Text style={{ color: "#C4B5FD", fontSize: 18 }}>
              {formatMarketplaceMoney(product.price_cents, product.currency)}
            </Text>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
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
