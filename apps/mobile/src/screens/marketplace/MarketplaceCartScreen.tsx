import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import {
  fetchMarketplaceDraft,
  fetchMarketplaceLiveCheckoutCapabilities,
  formatMarketplaceMoney,
  runMarketplaceCheckout,
  runMarketplaceLiveCheckout,
  saveMarketplaceDraft,
  type MarketplaceOrderDraft,
} from "../../lib/marketplaceApi";
import {
  setMarketplaceLocationCountryCode,
  type MarketplaceScopeInput,
} from "../../lib/marketplaceScope";
import {
  applyMmdLocationSelection,
  useMmdLocationPickerResult,
} from "../../lib/useMmdLocationPickerResult";
import { useTranslation } from "react-i18next";
import { useClientPlatformFeatures } from "../../hooks/useClientPlatformFeatures";
import { resolveMarketScopeFromFeatures } from "../../lib/marketScope";
import { rowDirection, textAlignStart } from "../../i18n/rtl";

type Props = {
  route: RouteProp<RootStackParamList, "MarketplaceCart">;
};

export default function MarketplaceCartScreen({ route }: Props) {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { sellerId, sellerName, sellerCountryCode, orderId } = route.params;
  const { features: platformFeatures } = useClientPlatformFeatures();
  const market = useMemo(
    () => resolveMarketScopeFromFeatures(platformFeatures),
    [platformFeatures]
  );
  const [dropoffLocationCountry, setDropoffLocationCountry] = useState<string | null>(null);
  const [draft, setDraft] = useState<MarketplaceOrderDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  const [dropoffLocationId, setDropoffLocationId] = useState<string | null>(null);
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [liveCheckoutEnabled, setLiveCheckoutEnabled] = useState(false);

  const marketplaceScope = useMemo<MarketplaceScopeInput>(
    () => ({
      sellerCountryCode,
      locationCountryCode: dropoffLocationCountry,
    }),
    [dropoffLocationCountry, sellerCountryCode]
  );

  const draftItems = useMemo(
    () =>
      (draft?.items ?? []).map((item) => ({
        product_id: String(item.product_id ?? ""),
        quantity: item.quantity,
      })).filter((item) => item.product_id),
    [draft?.items]
  );

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const order = await fetchMarketplaceDraft({ sellerId, orderId }, marketplaceScope);
      setDraft(order);
      if (order?.dropoff_location_id) {
        setDropoffLocationId(order.dropoff_location_id);
      }
    } catch (e) {
      Alert.alert(
        t("marketplace.cart.errorTitle", "Cart error"),
        e instanceof Error ? e.message : "Unknown error"
      );
    } finally {
      setLoading(false);
    }
  }, [marketplaceScope, orderId, sellerId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void fetchMarketplaceLiveCheckoutCapabilities().then((caps) => {
      setLiveCheckoutEnabled(caps.live_checkout_enabled);
    });
  }, []);

  useMmdLocationPickerResult(route, navigation, {
    marketplace_dropoff: (location) => {
      applyMmdLocationSelection(location, {
        setLocationId: setDropoffLocationId,
        setAddress: setDropoffAddress,
        setCountryCode: (code) => {
          setDropoffLocationCountry(code);
          setMarketplaceLocationCountryCode(code);
        },
      });
    },
  });

  async function persistDraftWithLocations(nextDropoffId?: string | null) {
    if (!draft?.id || draftItems.length === 0) return draft;
    setSavingLocation(true);
    try {
      const updated = await saveMarketplaceDraft({
        sellerId,
        orderId: draft.id,
        items: draftItems,
        dropoffLocationId: nextDropoffId ?? dropoffLocationId,
        sellerCountryCode,
        locationCountryCode: dropoffLocationCountry,
      });
      setDraft(updated);
      return updated;
    } finally {
      setSavingLocation(false);
    }
  }

  async function handleApplyDropoffLocation() {
    if (!dropoffLocationId) {
      Alert.alert(
        t("marketplace.cart.locationRequiredTitle", "Dropoff required"),
        t(
          "marketplace.cart.locationRequiredBody",
          "Choose a delivery location to improve shadow delivery estimates."
        )
      );
      return;
    }

    try {
      await persistDraftWithLocations(dropoffLocationId);
      Alert.alert(
        t("marketplace.cart.locationSavedTitle", "Location saved"),
        t(
          "marketplace.cart.locationSavedBody",
          "Delivery shadow will use your selected dropoff when enabled on the server."
        )
      );
    } catch (e) {
      Alert.alert(
        t("marketplace.cart.errorTitle", "Cart error"),
        e instanceof Error ? e.message : "Unknown error"
      );
    }
  }

  async function handleCheckoutShadow() {
    if (!draft?.id) return;
    try {
      setCheckingOut(true);
      const refreshed = dropoffLocationId
        ? await persistDraftWithLocations(dropoffLocationId)
        : draft;
      const body = await runMarketplaceCheckout(refreshed?.id ?? draft.id, marketplaceScope);
      setDraft(body.order ?? refreshed ?? draft);
      if (body.live_checkout_enabled === true) {
        setLiveCheckoutEnabled(true);
      }
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

  async function handleLiveCheckout() {
    if (!draft?.id) return;
    try {
      setCheckingOut(true);
      const refreshed = dropoffLocationId
        ? await persistDraftWithLocations(dropoffLocationId)
        : draft;
      const body = await runMarketplaceLiveCheckout(
        refreshed?.id ?? draft.id,
        marketplaceScope
      );
      if (body.order) setDraft(body.order);
      if (!body.checkout_url) {
        throw new Error("Missing checkout URL");
      }
      await Linking.openURL(body.checkout_url);
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
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("marketplace.cart.title", "Marketplace draft")}
        subtitle={sellerName}
        fallbackRoute="MarketplaceHome"
        variant="dark"
      />
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 14 }}>

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

            <View
              style={{
                borderWidth: 1,
                borderColor: "#334155",
                borderRadius: 12,
                padding: 12,
                gap: 8,
                backgroundColor: "#111827",
              }}
            >
              <Text style={{ color: "#F8FAFC", fontWeight: "600" }}>
                {t("marketplace.cart.dropoffTitle", "Delivery dropoff")}
              </Text>
              <Text style={{ color: dropoffAddress ? "#CBD5E1" : "#64748B" }}>
                {dropoffAddress ||
                  t(
                    "marketplace.cart.dropoffPlaceholder",
                    "No dropoff selected — shadow may use fallback distance."
                  )}
              </Text>
              <TouchableOpacity
                onPress={() =>
                  navigation.navigate("MMDLocationPicker", {
                    countryCode:
                      market.countryCode ||
                      dropoffLocationCountry ||
                      sellerCountryCode ||
                      draft.country_code ||
                      undefined,
                    title: t("marketplace.cart.pickDropoff", "Choose delivery location"),
                    submitLabel: t("marketplace.cart.useLocation", "Use this location"),
                    returnTo: "MarketplaceCart",
                    pickerContext: "marketplace_dropoff",
                  })
                }
                style={{
                  backgroundColor: "#312E81",
                  padding: 10,
                  borderRadius: 10,
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "#E9D5FF", fontWeight: "600" }}>
                  {t("marketplace.cart.chooseDropoff", "Choose dropoff on map")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={savingLocation || !dropoffLocationId}
                onPress={() => void handleApplyDropoffLocation()}
                style={{
                  backgroundColor: "#475569",
                  padding: 10,
                  borderRadius: 10,
                  alignItems: "center",
                  opacity: savingLocation || !dropoffLocationId ? 0.6 : 1,
                }}
              >
                <Text style={{ color: "#FFF", fontWeight: "600" }}>
                  {savingLocation
                    ? t("marketplace.cart.savingLocation", "Saving location…")
                    : t("marketplace.cart.applyDropoff", "Apply dropoff to draft")}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={{ gap: 6, marginTop: 8 }}>
              <Line
                label={t("marketplace.cart.subtotal", "Subtotal")}
                value={formatMarketplaceMoney(draft.subtotal_cents, draft.currency)}
              />
              <Line
                label={t("marketplace.cart.delivery", "Delivery (est.)")}
                value={formatMarketplaceMoney(draft.delivery_fee_cents, draft.currency)}
              />
              <Line
                label={t("marketplace.cart.service", "Service fee")}
                value={formatMarketplaceMoney(draft.service_fee_cents, draft.currency)}
              />
              <Line
                label={t("marketplace.cart.total", "Total")}
                value={formatMarketplaceMoney(draft.total_cents, draft.currency)}
                bold
              />
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

            {liveCheckoutEnabled ? (
              <TouchableOpacity
                disabled={checkingOut}
                onPress={() => void handleLiveCheckout()}
                style={{
                  backgroundColor: "#7C3AED",
                  padding: 14,
                  borderRadius: 12,
                  alignItems: "center",
                  opacity: checkingOut ? 0.7 : 1,
                }}
              >
                <Text style={{ color: "#FFF", fontWeight: "700" }}>
                  {t("marketplace.cart.payLive", "Pay Marketplace Order")}
                </Text>
              </TouchableOpacity>
            ) : null}
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
    <View style={{ flexDirection: rowDirection(), justifyContent: "space-between" }}>
      <Text style={{ color: bold ? "#F8FAFC" : "#94A3B8", fontWeight: bold ? "700" : "400" }}>
        {label}
      </Text>
      <Text style={{ color: bold ? "#C4B5FD" : "#CBD5E1", fontWeight: bold ? "700" : "400" }}>
        {value}
      </Text>
    </View>
  );
}
