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
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import { MarketplaceBrandState } from "../../components/marketplace/MarketplaceBrandState";
import {
  fetchMarketplaceDraft,
  fetchMarketplaceLiveCheckoutCapabilities,
  formatMarketplaceMoney,
  runMarketplaceCheckout,
  runMarketplaceLiveCheckout,
  confirmMarketplaceCheckoutPaid,
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
import { rowDirection } from "../../i18n/rtl";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_GREEN,
  MMD_LINK_BLUE,
  MMD_STROKE,
  MMD_TEXT,
  MMD_TEXT_MUTED_BLUE,
  MMD_WHITE,
} from "../../theme/mmdUi";

type Props = {
  route: RouteProp<RootStackParamList, "MarketplaceCart">;
};

export default function MarketplaceCartScreen({ route }: Props) {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { sellerId, sellerName, sellerCountryCode, orderId } =
    route.params ?? ({} as typeof route.params);
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
  const [paidOrder, setPaidOrder] = useState<MarketplaceOrderDraft | null>(null);

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
        toUserFacingError(e, t("common.unknownError", "Unknown error."))
      );
    } finally {
      setLoading(false);
    }
  }, [marketplaceScope, orderId, sellerId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void fetchMarketplaceLiveCheckoutCapabilities(marketplaceScope).then((caps) => {
      setLiveCheckoutEnabled(caps.live_checkout_enabled);
    });
  }, [marketplaceScope]);

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
        toUserFacingError(e, t("common.unknownError", "Unknown error."))
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
        toUserFacingError(e, t("common.unknownError", "Unknown error."))
      );
    } finally {
      setCheckingOut(false);
    }
  }

  async function handleLiveCheckout() {
    if (!draft?.id) return;
    if (liveCheckoutEnabled !== true) {
      Alert.alert(
        t("marketplace.cart.errorTitle", "Cart error"),
        t(
          "marketplace.cart.liveDisabled",
          "Live marketplace payment is not enabled. Use shadow checkout."
        )
      );
      return;
    }
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

      await WebBrowser.openBrowserAsync(body.checkout_url);

      let confirmResult: {
        ok?: boolean;
        already_paid?: boolean;
        stripe_paid?: boolean;
        payment_status?: string | null;
        order?: MarketplaceOrderDraft;
        error?: string;
      } | null = null;
      let confirmThrew = false;
      try {
        confirmResult = await confirmMarketplaceCheckoutPaid(
          refreshed?.id ?? draft.id,
          body.stripe_checkout_session_id ?? body.order?.stripe_checkout_session_id ?? null,
          marketplaceScope
        );
      } catch {
        confirmThrew = true;
      }

      const paidOk =
        !confirmThrew &&
        (confirmResult?.ok === true ||
          confirmResult?.already_paid === true ||
          confirmResult?.stripe_paid === true ||
          String(confirmResult?.payment_status ?? "").toLowerCase() === "paid");

      if (!paidOk) {
        Alert.alert(
          t("marketplace.cart.paymentCancelledTitle", "Payment not completed"),
          t(
            "marketplace.cart.paymentCancelledBody",
            "Stripe checkout was cancelled or not finished. Your draft cart is still saved."
          )
        );
        return;
      }

      if (confirmResult?.order) {
        setPaidOrder(confirmResult.order);
      }
      Alert.alert(
        t("marketplace.cart.paymentSuccessTitle", "Payment confirmed"),
        t(
          "marketplace.cart.paymentSuccessBody",
          "Your marketplace order is paid. The seller will update fulfillment status."
        )
      );
    } catch (e) {
      Alert.alert(
        t("marketplace.cart.errorTitle", "Cart error"),
        toUserFacingError(e, t("common.unknownError", "Unknown error."))
      );
    } finally {
      setCheckingOut(false);
    }
  }

  const checkoutEnabled = Boolean(draft?.checkout_shadow?.checkout_enabled);
  const orderIsPaid =
    paidOrder?.payment_status === "paid" ||
    paidOrder?.status === "paid" ||
    draft?.payment_status === "paid" ||
    draft?.status === "paid";
  const statusOrder = paidOrder ?? draft;

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={t("marketplace.cart.title", "Marketplace draft")}
        subtitle={sellerName}
        fallbackRoute="MarketplaceHome"
        variant="mmd"
      />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          loading || !draft || !(draft.items ?? []).length
            ? styles.scrollFill
            : null,
        ]}
      >
        {loading ? (
          <MarketplaceBrandState
            mode="loading"
            message={t("marketplace.cart.loading", "Loading draft cart...")}
          />
        ) : !draft || !(draft.items ?? []).length ? (
          <MarketplaceBrandState
            mode="empty"
            title={t("marketplace.cart.empty", "Your draft cart is empty.")}
            message={t(
              "marketplace.cart.emptyHint",
              "Browse a shop and add products to continue."
            )}
          />
        ) : (
          <>
            {(draft.items ?? []).map((item) => (
              <View key={item.id} style={styles.itemCard}>
                <Text style={styles.itemTitle}>{item.title}</Text>
                <Text style={styles.itemMeta}>
                  {item.quantity} × {formatMarketplaceMoney(item.price_cents, item.currency)}
                </Text>
              </View>
            ))}

            <View style={styles.dropoffCard}>
              <Text style={styles.itemTitle}>
                {t("marketplace.cart.dropoffTitle", "Delivery dropoff")}
              </Text>
              <Text style={styles.dropoffHint}>
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
                style={styles.chooseDropoff}
              >
                <Text style={styles.chooseDropoffText}>
                  {t("marketplace.cart.chooseDropoff", "Choose dropoff on map")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={savingLocation || !dropoffLocationId}
                onPress={() => void handleApplyDropoffLocation()}
                style={[
                  styles.applyDropoff,
                  { opacity: savingLocation || !dropoffLocationId ? 0.6 : 1 },
                ]}
              >
                <Text style={styles.applyDropoffText}>
                  {savingLocation
                    ? t("marketplace.cart.savingLocation", "Saving location…")
                    : t("marketplace.cart.applyDropoff", "Apply dropoff to draft")}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.totals}>
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
              <View style={styles.shadowCard}>
                <Text style={styles.shadowTitle}>
                  {t("marketplace.cart.deliveryShadowTitle", "Estimated delivery (shadow)")}
                </Text>
                {draft.estimated_distance_miles != null ? (
                  <Text style={styles.shadowMeta}>
                    {Number(draft.estimated_distance_miles).toFixed(1)} mi ·{" "}
                    {Math.round(Number(draft.estimated_minutes ?? 0))} min
                  </Text>
                ) : null}
                {draft.delivery_quote_shadow?.customer_delivery_total_cents != null ? (
                  <Text style={styles.shadowMeta}>
                    {t("marketplace.cart.deliveryShadowFee", "Delivery quote shadow")}:{" "}
                    {formatMarketplaceMoney(
                      draft.delivery_quote_shadow.customer_delivery_total_cents,
                      draft.currency
                    )}
                  </Text>
                ) : null}
                <Text style={styles.shadowNote}>
                  {liveCheckoutEnabled
                    ? t(
                        "marketplace.cart.deliveryShadowNoteLive",
                        "Estimate only — live checkout is enabled; driver dispatch depends on seller and region."
                      )
                    : t(
                        "marketplace.cart.deliveryShadowNote",
                        "Shadow only — checkout and driver dispatch are not live yet."
                      )}
                </Text>
              </View>
            ) : null}

            {orderIsPaid && statusOrder ? (
              <View style={styles.paidCard}>
                <Text style={styles.paidTitle}>
                  {t("marketplace.cart.orderPaidTitle", "Order paid")}
                </Text>
                <Text style={styles.paidMeta}>
                  {t("marketplace.cart.orderStatus", "Status")}: {statusOrder.status}
                  {statusOrder.payment_status
                    ? ` · ${t("marketplace.cart.paymentStatus", "Payment")}: ${statusOrder.payment_status}`
                    : ""}
                </Text>
                <TouchableOpacity
                  onPress={() => navigation.navigate("MarketplaceHome")}
                  style={styles.paidHomeBtn}
                >
                  <Text style={styles.checkoutBtnText}>
                    {t("marketplace.cart.backToMarketplace", "Back to marketplace")}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {liveCheckoutEnabled !== true ? (
              <Text style={styles.comingSoonNote}>
                {t(
                  "marketplace.cart.checkoutStillComingSoon",
                  "Checkout still coming soon — no live marketplace payment."
                )}
              </Text>
            ) : null}

            {liveCheckoutEnabled === true && !orderIsPaid ? (
              <TouchableOpacity
                disabled={checkingOut}
                onPress={() => void handleLiveCheckout()}
                style={[
                  styles.checkoutBtn,
                  {
                    backgroundColor: MMD_LINK_BLUE,
                    opacity: checkingOut ? 0.7 : 1,
                  },
                ]}
              >
                <Text style={styles.checkoutBtnText}>
                  {checkingOut
                    ? t("marketplace.cart.processing", "Processing…")
                    : t("marketplace.cart.payLive", "Pay Marketplace Order")}
                </Text>
              </TouchableOpacity>
            ) : null}

            {!orderIsPaid ? (
              <TouchableOpacity
                disabled={checkingOut}
                onPress={() => void handleCheckoutShadow()}
                style={[
                  liveCheckoutEnabled ? styles.prepareBtn : styles.checkoutBtn,
                  {
                    backgroundColor: liveCheckoutEnabled
                      ? "transparent"
                      : checkoutEnabled
                        ? MMD_GREEN
                        : "#475569",
                    opacity: checkingOut ? 0.7 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.checkoutBtnText,
                    liveCheckoutEnabled ? styles.prepareBtnText : null,
                  ]}
                >
                  {checkingOut
                    ? t("marketplace.cart.processing", "Processing…")
                    : liveCheckoutEnabled
                      ? t("marketplace.cart.prepareTotals", "Refresh checkout totals")
                      : checkoutEnabled
                        ? t("marketplace.cart.checkout", "Prepare checkout")
                        : t("marketplace.cart.comingSoonCta", "Marketplace checkout coming soon")}
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
      <Text
        style={{
          color: bold ? MMD_TEXT : MMD_TEXT_MUTED_BLUE,
          fontWeight: bold ? "700" : "400",
          fontFamily: bold ? MMD_FONT.bold : MMD_FONT.regular,
          fontSize: 13,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: MMD_GOLD_CLASSIC,
          fontWeight: bold ? "700" : "400",
          fontFamily: bold ? MMD_FONT.bold : MMD_FONT.regular,
          fontSize: 13,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  scroll: { padding: 20, paddingTop: 8, gap: 14 },
  scrollFill: { flexGrow: 1 },
  itemCard: {
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    borderRadius: 12,
    padding: 12,
    backgroundColor: MMD_BLUE,
    gap: 4,
  },
  itemTitle: {
    color: MMD_TEXT,
    fontFamily: MMD_FONT.semibold,
    fontSize: 14,
    fontWeight: "600",
  },
  itemMeta: {
    color: MMD_TEXT_MUTED_BLUE,
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
  },
  dropoffCard: {
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    backgroundColor: MMD_BLUE,
  },
  dropoffHint: {
    color: MMD_LINK_BLUE,
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
  },
  chooseDropoff: {
    backgroundColor: "#312E81",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  chooseDropoffText: {
    color: "#E9D5FF",
    fontFamily: MMD_FONT.semibold,
    fontSize: 13,
    fontWeight: "600",
  },
  applyDropoff: {
    backgroundColor: "#475569",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  applyDropoffText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontSize: 13,
    fontWeight: "600",
  },
  totals: { gap: 6 },
  shadowCard: {
    borderWidth: 1,
    borderColor: MMD_STROKE,
    borderRadius: 12,
    padding: 12,
    backgroundColor: "rgba(114,159,250,0.12)",
    gap: 4,
  },
  shadowTitle: {
    color: MMD_LINK_BLUE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  shadowMeta: {
    color: MMD_TEXT_MUTED_BLUE,
    fontFamily: MMD_FONT.regular,
  },
  shadowNote: {
    color: MMD_TEXT_MUTED_BLUE,
    fontSize: 12,
    fontFamily: MMD_FONT.regular,
  },
  comingSoonNote: {
    color: MMD_LINK_BLUE,
    fontSize: 12,
    fontFamily: MMD_FONT.regular,
  },
  paidCard: {
    borderWidth: 1,
    borderColor: MMD_STROKE,
    borderRadius: 12,
    padding: 12,
    backgroundColor: "rgba(34,197,94,0.12)",
    gap: 8,
  },
  paidTitle: {
    color: MMD_GREEN,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  paidMeta: {
    color: MMD_TEXT_MUTED_BLUE,
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
  },
  paidHomeBtn: {
    backgroundColor: MMD_GREEN,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  checkoutBtn: {
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  checkoutBtnText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontSize: 13,
    fontWeight: "600",
  },
  prepareBtn: {
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  prepareBtnText: {
    color: MMD_LINK_BLUE,
  },
});
