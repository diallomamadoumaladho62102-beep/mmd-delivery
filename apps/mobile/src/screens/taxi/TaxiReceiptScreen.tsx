import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  StyleSheet,
  Share,
  Linking,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import {
  WalletEmptyState,
  WalletErrorState,
  WalletLoadingState,
  WalletHistoryRow,
} from "../../components/wallet/WalletPrimitives";
import { financialStatusColor } from "../../components/wallet/walletStatusColor";
import { fetchTaxiReceipt } from "../../lib/taxiReceiptApi";
import type { TaxiReceipt } from "../../lib/taxiReceiptTypes";
import { printTaxiReceiptPdf } from "../../lib/taxiReceiptPrint";
import {
  fetchTaxiRideRating,
  submitTaxiRideRating,
} from "../../lib/taxiClientApi";
import {
  formatMoneyFromCents,
  formatDateTime,
  formatDistance,
  formatDurationMinutes,
} from "../../i18n/formatters";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  MMD_ACTION_NAVY,
  MMD_BLUE,
  MMD_FONT,
  MMD_GLASS,
  MMD_GOLD_CLASSIC,
  MMD_GOLD_CLASSIC_BORDER,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../../theme/mmdUi";

const MMD_LOGO = require("../../../assets/brand/mmd-logo-ui.png");

export default function TaxiReceiptScreen() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const rideId = String(route.params?.rideId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<TaxiReceipt | null>(null);
  const [myRating, setMyRating] = useState<number | null>(null);
  const [ratingSaving, setRatingSaving] = useState(false);

  const currency = receipt?.invoice.currency ?? "USD";
  const lang = i18n.language;

  const money = useCallback(
    (cents: number) => formatMoneyFromCents(cents, currency, lang),
    [currency, lang]
  );

  const fareLabels = useMemo(() => {
    const keys = [
      "taxi.receipt.fare.base",
      "taxi.receipt.fare.distance",
      "taxi.receipt.fare.time",
      "taxi.receipt.fare.minimum",
      "taxi.receipt.fare.surge",
      "taxi.receipt.fare.tolls",
      "taxi.receipt.fare.parking",
      "taxi.receipt.fare.bookingFee",
      "taxi.receipt.fare.wait",
      "taxi.receipt.fare.airport",
      "taxi.receipt.fare.regulatory",
      "taxi.receipt.fare.regulatoryFee",
      "taxi.receipt.fare.cleaning",
      "taxi.receipt.fare.tax",
      "taxi.receipt.fare.promo",
      "taxi.receipt.fare.coupon",
      "taxi.receipt.fare.loyalty",
      "taxi.receipt.fare.shared",
      "taxi.receipt.fare.walletCredit",
      "taxi.receipt.fare.mmdPlus",
      "taxi.receipt.fare.tip",
      "taxi.receipt.fare.refund",
      "taxi.receipt.fare.adjustment",
      "taxi.receipt.fare.total",
      "taxi.receipt.invoice",
      "taxi.receipt.ride",
      "taxi.receipt.trip",
      "taxi.receipt.pickup",
      "taxi.receipt.dropoff",
      "taxi.receipt.driver",
      "taxi.receipt.payment",
      "taxi.receipt.totalPaid",
      "taxi.receipt.history",
      "taxi.receipt.support",
      "taxi.receipt.paymentRef",
      "finance.event.payment",
      "finance.event.tip",
      "finance.event.refund",
      "finance.event.wallet_credit",
      "finance.event.driver_commission",
      "finance.event.stripe_transfer",
    ];
    const out: Record<string, string> = {};
    for (const k of keys) {
      out[k] = t(k, k.split(".").pop() ?? k);
    }
    return out;
  }, [t]);

  const refresh = useCallback(async () => {
    if (!rideId) {
      setError(t("taxi.receipt.missingRide", "Missing ride id"));
      setReceipt(null);
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const [data, ratingRes] = await Promise.all([
        fetchTaxiReceipt(rideId),
        fetchTaxiRideRating(rideId).catch(() => ({ ok: false, rating: null })),
      ]);
      setReceipt(data);
      const existing = ratingRes && "rating" in ratingRes ? ratingRes.rating : null;
      setMyRating(
        existing && typeof existing.rating === "number" ? existing.rating : null,
      );
    } catch (e) {
      setReceipt(null);
      setError(
        toUserFacingError(e, t("taxi.receipt.loadError", "Unable to load receipt")),
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [rideId, t]);

  const onSubmitRating = useCallback(
    async (stars: number) => {
      if (!rideId || ratingSaving) return;
      try {
        setRatingSaving(true);
        const res = await submitTaxiRideRating({ rideId, rating: stars });
        setMyRating(Number(res.rating?.rating ?? stars));
        Alert.alert(
          t("taxi.receipt.ratingSavedTitle", "Thank you"),
          t("taxi.receipt.ratingSavedBody", "Your rating was saved."),
        );
      } catch (e) {
        Alert.alert(
          t("taxi.receipt.ratingErrorTitle", "Rating"),
          toUserFacingError(e, t("taxi.receipt.ratingErrorBody", "Unable to save rating.")),
        );
      } finally {
        setRatingSaving(false);
      }
    },
    [rideId, ratingSaving, t],
  );

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        setLoading(true);
        await refresh();
        if (alive) setLoading(false);
      })();
      return () => {
        alive = false;
      };
    }, [refresh])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  if (loading && !receipt) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <ScreenHeader title={t("taxi.receipt.title", "Receipt")} />
        <WalletLoadingState label={t("common.loading", "Loading…")} />
      </SafeAreaView>
    );
  }

  if (error && !receipt) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <ScreenHeader title={t("taxi.receipt.title", "Receipt")} />
        <WalletErrorState
          message={error}
          retryLabel={t("common.retry", "Retry")}
          onRetry={() => {
            setLoading(true);
            void refresh().finally(() => setLoading(false));
          }}
        />
      </SafeAreaView>
    );
  }

  if (!receipt) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <ScreenHeader title={t("taxi.receipt.title", "Receipt")} />
        <WalletEmptyState
          title={t("taxi.receipt.emptyTitle", "No receipt")}
          body={t("taxi.receipt.emptyBody", "This ride has no receipt yet.")}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScreenHeader title={t("taxi.receipt.title", "Receipt")} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={MMD_TAXI_GREEN} />
        }
      >
        <View style={styles.headerCard} accessibilityRole="header">
          <Image
            source={MMD_LOGO}
            style={{ width: 48, height: 48, borderRadius: 14, marginBottom: 8 }}
            resizeMode="contain"
            accessibilityLabel="MMD Delivery"
          />
          <Text style={styles.brand}>{receipt.company.brand}</Text>
          <Text style={styles.legal}>{receipt.company.legal_name}</Text>
          <Text style={styles.meta}>
            {t("taxi.receipt.invoice", "Invoice")} {receipt.invoice.invoice_number}
          </Text>
          <Text style={styles.meta}>
            {t("taxi.receipt.ride", "Ride")} {receipt.invoice.ride_number}
          </Text>
          <Text style={styles.meta}>
            {formatDateTime(receipt.invoice.issued_at, lang)}
          </Text>
          <Text style={styles.status}>{receipt.invoice.payment_status}</Text>
        </View>

        <Text style={styles.sectionTitle}>{t("taxi.receipt.trip", "Trip")}</Text>
        {receipt.trip.map_static_url ? (
          <Image
            source={{ uri: receipt.trip.map_static_url }}
            style={styles.map}
            accessibilityLabel={t("taxi.receipt.tripMap", "Trip map")}
          />
        ) : (
          <View
            style={styles.mapFallback}
            accessibilityRole="text"
            accessibilityLabel={t("taxi.receipt.mapUnavailable", "Trip map unavailable")}
          >
            <Text style={styles.meta}>
              {t("taxi.receipt.mapUnavailable", "Trip map unavailable")}
            </Text>
          </View>
        )}
        <View style={styles.card}>
          <Text style={styles.label}>{t("taxi.receipt.pickup", "Pickup")}</Text>
          <Text style={styles.value}>{receipt.trip.pickup_address}</Text>
          <Text style={[styles.label, { marginTop: 12 }]}>
            {t("taxi.receipt.dropoff", "Dropoff")}
          </Text>
          <Text style={styles.value}>{receipt.trip.dropoff_address}</Text>
          <Text style={styles.meta}>
            {formatDistance(receipt.trip.distance_miles, lang)}
            {" · "}
            {formatDurationMinutes(receipt.trip.duration_minutes, lang)}
            {receipt.trip.wait_fee_minutes
              ? ` · ${t("taxi.receipt.wait", "Wait")} ${formatDurationMinutes(receipt.trip.wait_fee_minutes, lang)}`
              : ""}
            {receipt.trip.vehicle_category
              ? ` · ${receipt.trip.vehicle_category}`
              : ""}
          </Text>
        </View>

        {receipt.driver ? (
          <>
            <Text style={styles.sectionTitle}>{t("taxi.receipt.driver", "Driver")}</Text>
            <View style={styles.cardRow}>
              {receipt.driver.photo_url ? (
                <Image
                  source={{ uri: receipt.driver.photo_url }}
                  style={styles.avatar}
                  accessibilityIgnoresInvertColors
                />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.value}>{receipt.driver.name}</Text>
                <Text style={styles.meta}>
                  {[receipt.driver.vehicle_label, receipt.driver.plate]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
                {receipt.driver.rating != null ? (
                  <Text style={styles.meta}>
                    {t("taxi.receipt.rating", "Rating")}:{" "}
                    {receipt.driver.rating.toFixed(1)}
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={styles.card}>
              <Text style={styles.label}>
                {myRating
                  ? t("taxi.receipt.yourRating", "Your rating")
                  : t("taxi.receipt.rateDriver", "Rate your driver")}
              </Text>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((star) => {
                  const active = (myRating ?? 0) >= star;
                  return (
                    <TouchableOpacity
                      key={star}
                      disabled={ratingSaving || myRating != null}
                      onPress={() => void onSubmitRating(star)}
                      accessibilityRole="button"
                      accessibilityLabel={`${star} stars`}
                      style={styles.starBtn}
                    >
                      <Text style={[styles.star, active && styles.starActive]}>
                        {active ? "★" : "☆"}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {ratingSaving ? (
                  <ActivityIndicator color={MMD_GOLD_CLASSIC} style={{ marginLeft: 8 }} />
                ) : null}
              </View>
            </View>
          </>
        ) : null}

        <Text style={styles.sectionTitle}>{t("taxi.receipt.payment", "Payment")}</Text>
        <View style={styles.card}>
          {receipt.fare_lines.map((line) => (
            <View key={line.key} style={styles.fareRow}>
              <Text style={styles.fareLabel}>
                {t(line.label_key, line.key)}
              </Text>
              <Text
                style={[
                  styles.fareAmount,
                  line.amount_cents < 0 ? styles.discount : null,
                ]}
              >
                {money(line.amount_cents)}
              </Text>
            </View>
          ))}
          <View style={[styles.fareRow, styles.totalRow]}>
            <Text style={styles.totalLabel}>
              {t("taxi.receipt.totalPaid", "Total paid")}
            </Text>
            <Text style={styles.totalValue}>
              {money(receipt.totals.total_paid_cents)}
            </Text>
          </View>
          <Text style={styles.meta}>
            {[
              receipt.payment.method === "business_wallet"
                ? t("taxi.receipt.businessWallet", "Business wallet")
                : t("taxi.receipt.card", "Card"),
              receipt.payment.brand,
              receipt.payment.last4
                ? `•••• ${receipt.payment.last4}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          {receipt.payment.payment_intent_id ? (
            <Text style={styles.meta}>
              {t("taxi.receipt.paymentRef", "Payment ref")}:{" "}
              {receipt.payment.payment_intent_id}
            </Text>
          ) : null}
        </View>

        {receipt.financial_timeline.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>
              {t("taxi.receipt.history", "Financial history")}
            </Text>
            <View style={styles.card}>
              {receipt.financial_timeline.map((ev) => (
                <WalletHistoryRow
                  key={ev.id}
                  title={t(ev.title_key, ev.title_fallback)}
                  meta={`${formatDateTime(ev.occurred_at, lang)} · ${ev.status}`}
                  amount={money(ev.amount_cents)}
                  amountColor={financialStatusColor(ev.status)}
                  detail={ev.subtitle}
                />
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.sectionTitle}>{t("taxi.receipt.support", "Support")}</Text>
        <View style={styles.card}>
          <TouchableOpacity
            onPress={() => Linking.openURL(`mailto:${receipt.company.support_email}`)}
            accessibilityRole="link"
          >
            <Text style={styles.link}>{receipt.company.support_email}</Text>
          </TouchableOpacity>
          {receipt.company.support_phone ? (
            <TouchableOpacity
              onPress={() => Linking.openURL(`tel:${receipt.company.support_phone}`)}
              accessibilityRole="link"
            >
              <Text style={styles.link}>{receipt.company.support_phone}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={() => Linking.openURL(receipt.company.support_url)}
            accessibilityRole="link"
          >
            <Text style={styles.link}>
              {t("taxi.receipt.helpCenter", "Help center")}
            </Text>
          </TouchableOpacity>
          <Text style={styles.meta}>{receipt.invoice.invoice_number}</Text>
        </View>

        <Text style={styles.sectionTitle}>{t("taxi.receipt.actions", "Actions")}</Text>
        <View style={styles.actions}>
          <ActionBtn
            label={t("taxi.receipt.downloadPdf", "Download PDF")}
            onPress={async () => {
              try {
                await printTaxiReceiptPdf(receipt, fareLabels, lang);
              } catch (e) {
                setError(
                  toUserFacingError(
                    e,
                    t("taxi.receipt.pdfFailed", "Unable to create PDF")
                  )
                );
              }
            }}
          />
          <ActionBtn
            label={t("taxi.receipt.share", "Share")}
            onPress={() =>
              Share.share({
                message: `${receipt.company.brand} ${receipt.invoice.invoice_number}\n${receipt.invoice.qr_url}`,
                url: receipt.invoice.qr_url,
              })
            }
          />
          {receipt.actions.can_tip ? (
            <ActionBtn
              label={t("taxi.receipt.addTip", "Add a tip")}
              onPress={() => navigation.navigate("TaxiTip", { rideId })}
            />
          ) : null}
          {receipt.actions.can_rebook ? (
            <ActionBtn
              label={t("taxi.receipt.rebook", "Book again")}
              onPress={() => navigation.navigate("TaxiHome")}
            />
          ) : null}
          <ActionBtn
            label={t("taxi.receipt.contactSupport", "Contact support")}
            onPress={() => Linking.openURL(`mailto:${receipt.company.support_email}?subject=${encodeURIComponent(receipt.invoice.invoice_number)}`)}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ActionBtn({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.actionBtn}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.actionText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  content: { padding: 16, paddingBottom: 40 },
  headerCard: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
    padding: 24,
    marginBottom: 16,
    alignItems: "center",
  },
  brand: {
    color: MMD_WHITE,
    fontSize: 22,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
  },
  legal: {
    color: "rgba(255,255,255,0.4)",
    marginTop: 4,
    fontWeight: "400",
    fontFamily: MMD_FONT.regular,
    fontSize: 12,
  },
  meta: {
    color: "rgba(255,255,255,0.5)",
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: MMD_FONT.regular,
  },
  status: {
    marginTop: 10,
    color: MMD_WHITE,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
    textTransform: "uppercase",
    fontSize: 11,
    backgroundColor: MMD_TAXI_GREEN,
    overflow: "hidden",
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 12,
  },
  sectionTitle: {
    color: "rgba(255,255,255,0.4)",
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
    fontSize: 11,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: 8,
    marginTop: 8,
  },
  card: {
    backgroundColor: MMD_GLASS,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
    padding: 16,
    marginBottom: 14,
  },
  cardRow: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: MMD_GLASS,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
    padding: 16,
    marginBottom: 14,
    alignItems: "center",
  },
  map: {
    width: "100%",
    height: 180,
    borderRadius: 14,
    marginBottom: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  mapFallback: {
    width: "100%",
    minHeight: 72,
    borderRadius: 14,
    marginBottom: 12,
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: {
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    color: "rgba(255,255,255,0.4)",
    fontWeight: "400",
    fontFamily: MMD_FONT.regular,
    fontSize: 12,
  },
  value: {
    color: MMD_WHITE,
    fontWeight: "700",
    fontFamily: MMD_FONT.bold,
    marginTop: 4,
    lineHeight: 20,
  },
  fareRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  fareLabel: {
    color: MMD_WHITE,
    flex: 1,
    paddingRight: 12,
    fontFamily: MMD_FONT.regular,
  },
  fareAmount: { color: MMD_WHITE, fontWeight: "800", fontFamily: MMD_FONT.extrabold },
  discount: { color: MMD_TAXI_GREEN },
  totalRow: { borderBottomWidth: 0, marginTop: 4 },
  totalLabel: {
    color: MMD_WHITE,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
    fontSize: 20,
  },
  totalValue: {
    color: MMD_WHITE,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
    fontSize: 20,
  },
  link: { color: MMD_GOLD_CLASSIC, fontWeight: "700", fontFamily: MMD_FONT.bold, marginTop: 8 },
  starsRow: { flexDirection: "row", alignItems: "center", marginTop: 8, gap: 4 },
  starBtn: { padding: 4 },
  star: { fontSize: 28, color: "rgba(255,255,255,0.35)" },
  starActive: { color: MMD_GOLD_CLASSIC },
  actions: { gap: 10, marginBottom: 24 },
  actionBtn: {
    backgroundColor: MMD_ACTION_NAVY,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  actionText: {
    color: MMD_WHITE,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
    fontSize: 14,
  },
});
