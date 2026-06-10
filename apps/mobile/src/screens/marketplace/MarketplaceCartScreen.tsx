import React, { useCallback, useEffect, useState } from "react";
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
  fetchMarketplaceDraft,
  formatMarketplaceMoney,
  runMarketplaceCheckout,
  type MarketplaceOrderDraft,
} from "../../lib/marketplaceApi";
import { useTranslation } from "react-i18next";

type Props = NativeStackScreenProps<RootStackParamList, "MarketplaceCart">;

export default function MarketplaceCartScreen({ route }: Props) {
  const { t } = useTranslation();
  const { sellerId, orderId } = route.params;
  const [draft, setDraft] = useState<MarketplaceOrderDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const order = await fetchMarketplaceDraft({ sellerId, orderId });
      setDraft(order);
    } catch (e) {
      Alert.alert(
        t("marketplace.cart.errorTitle", "Cart error"),
        e instanceof Error ? e.message : "Unknown error"
      );
    } finally {
      setLoading(false);
    }
  }, [orderId, sellerId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCheckoutShadow() {
    if (!draft?.id) return;
    try {
      setCheckingOut(true);
      const body = await runMarketplaceCheckout(draft.id);
      setDraft(body.order ?? draft);
      Alert.alert(
        body.checkout_enabled
          ? t("marketplace.cart.checkoutReadyTitle", "Checkout prepared")
          : t("marketplace.cart.comingSoonTitle", "Coming soon"),
        body.message ??
          t(
            "marketplace.cart.comingSoonBody",
            "Marketplace checkout coming soon. Shadow totals were calculated only."
          )
      );
    } catch (e) {
      Alert.alert(
        t("marketplace.cart.errorTitle", "Cart error"),
        e instanceof Error ? e.message : "Unknown error"
      );
    } finally {
      setCheckingOut(false);
    }
  }

  const checkoutEnabled = Boolean(draft?.checkout_shadow?.checkout_enabled);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <Text style={{ color: "#F8FAFC", fontSize: 24, fontWeight: "700" }}>
          {t("marketplace.cart.title", "Marketplace draft")}
        </Text>

        {loading ? (
          <ActivityIndicator color="#A78BFA" />
        ) : !draft || !(draft.items ?? []).length ? (
          <Text style={{ color: "#CBD5E1" }}>
            {t("marketplace.cart.empty", "Your draft cart is empty.")}
          </Text>
        ) : (
          <>
            {(draft.items ?? []).map((item) => (
              <View
                key={item.id}
                style={{
                  borderWidth: 1,
                  borderColor: "#334155",
                  borderRadius: 12,
                  padding: 12,
                  backgroundColor: "#111827",
                }}
              >
                <Text style={{ color: "#F8FAFC", fontWeight: "600" }}>{item.title}</Text>
                <Text style={{ color: "#94A3B8", marginTop: 4 }}>
                  {item.quantity} × {formatMarketplaceMoney(item.price_cents, item.currency)}
                </Text>
              </View>
            ))}

            <View style={{ gap: 6, marginTop: 8 }}>
              <Line label={t("marketplace.cart.subtotal", "Subtotal")} value={formatMarketplaceMoney(draft.subtotal_cents, draft.currency)} />
              <Line label={t("marketplace.cart.delivery", "Delivery (est.)")} value={formatMarketplaceMoney(draft.delivery_fee_cents, draft.currency)} />
              <Line label={t("marketplace.cart.service", "Service fee")} value={formatMarketplaceMoney(draft.service_fee_cents, draft.currency)} />
              <Line label={t("marketplace.cart.total", "Total")} value={formatMarketplaceMoney(draft.total_cents, draft.currency)} bold />
            </View>

            {draft.delivery_status_shadow &&
            draft.delivery_status_shadow !== "not_started" ? (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: "#4338CA",
                  borderRadius: 12,
                  padding: 12,
                  backgroundColor: "rgba(67,56,202,0.12)",
                  gap: 4,
                }}
              >
                <Text style={{ color: "#C4B5FD", fontWeight: "700" }}>
                  {t("marketplace.cart.deliveryShadowTitle", "Estimated delivery (shadow)")}
                </Text>
                {draft.estimated_distance_miles != null ? (
                  <Text style={{ color: "#CBD5E1" }}>
                    {Number(draft.estimated_distance_miles).toFixed(1)} mi ·{" "}
                    {Math.round(Number(draft.estimated_minutes ?? 0))} min
                  </Text>
                ) : null}
                {draft.delivery_quote_shadow?.customer_delivery_total_cents != null ? (
                  <Text style={{ color: "#94A3B8" }}>
                    {t("marketplace.cart.deliveryShadowFee", "Delivery quote shadow")}:{" "}
                    {formatMarketplaceMoney(
                      draft.delivery_quote_shadow.customer_delivery_total_cents,
                      draft.currency
                    )}
                  </Text>
                ) : null}
                <Text style={{ color: "#64748B", fontSize: 12 }}>
                  {t(
                    "marketplace.cart.deliveryShadowNote",
                    "Shadow only — checkout and driver dispatch are not live yet."
                  )}
                </Text>
              </View>
            ) : null}

            <Text style={{ color: "#64748B", fontSize: 12 }}>
              {t(
                "marketplace.cart.checkoutStillComingSoon",
                "Checkout still coming soon — no live marketplace payment."
              )}
            </Text>

            <TouchableOpacity
              disabled={checkingOut}
              onPress={() => void handleCheckoutShadow()}
              style={{
                backgroundColor: checkoutEnabled ? "#059669" : "#475569",
                padding: 14,
                borderRadius: 12,
                alignItems: "center",
                opacity: checkingOut ? 0.7 : 1,
              }}
            >
              <Text style={{ color: "#FFF", fontWeight: "700" }}>
                {checkingOut
                  ? t("marketplace.cart.processing", "Processing…")
                  : checkoutEnabled
                    ? t("marketplace.cart.checkout", "Prepare checkout")
                    : t("marketplace.cart.comingSoonCta", "Marketplace checkout coming soon")}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Line({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Text style={{ color: bold ? "#F8FAFC" : "#94A3B8", fontWeight: bold ? "700" : "400" }}>
        {label}
      </Text>
      <Text style={{ color: bold ? "#C4B5FD" : "#CBD5E1", fontWeight: bold ? "700" : "400" }}>
        {value}
      </Text>
    </View>
  );
}
