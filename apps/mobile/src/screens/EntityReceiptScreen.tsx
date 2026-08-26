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
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../components/navigation/ScreenHeader";
import {
  WalletEmptyState,
  WalletErrorState,
  WalletLoadingState,
  WalletHistoryRow,
} from "../components/wallet/WalletPrimitives";
import { financialStatusColor } from "../components/wallet/walletStatusColor";
import type { EntityReceipt } from "../lib/entityReceiptTypes";
import { printEntityReceiptPdf } from "../lib/entityReceiptPrint";
import {
  formatMoneyFromCents,
  formatDateTime,
  formatDistance,
  formatDurationMinutes,
} from "../i18n/formatters";
import { toUserFacingError } from "../lib/userFacingError";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GLASS,
  MMD_GOLD_BRIGHT,
  MMD_GOLD_CLASSIC_BORDER,
  MMD_TAXI_GREEN,
  MMD_WHITE,
  mmdLogoSizeCompact,
} from "../theme/mmdUi";
import { ClientServiceBottomNav } from "../components/navigation/ClientServiceBottomNav";

type Props = {
  entityId: string;
  fetchReceipt: (id: string) => Promise<EntityReceipt>;
  entityLabelKey: string;
  entityLabelFallback: string;
  hideCustomerNav?: boolean;
};

export function EntityReceiptScreenBody({
  entityId,
  fetchReceipt,
  entityLabelKey,
  entityLabelFallback,
  hideCustomerNav,
}: Props) {
  const { t, i18n } = useTranslation();
  const { width, height } = useWindowDimensions();
  const logoSize = mmdLogoSizeCompact(width, height);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<EntityReceipt | null>(null);

  const currency = receipt?.invoice.currency ?? "USD";
  const lang = i18n.language;

  const money = useCallback(
    (cents: number) => formatMoneyFromCents(cents, currency, lang),
    [currency, lang]
  );

  const fareLabels = useMemo(() => {
    const keys = [
      "order.receipt.fare.subtotal",
      "order.receipt.fare.tax",
      "order.receipt.fare.serviceFee",
      "order.receipt.fare.deliveryFee",
      "order.receipt.fare.promo",
      "order.receipt.fare.walletCredit",
      "order.receipt.fare.tip",
      "order.receipt.invoice",
      "order.receipt.order",
      "order.receipt.package",
      "order.receipt.delivery",
      "order.receipt.pickup",
      "order.receipt.dropoff",
      "order.receipt.restaurant",
      "order.receipt.driver",
      "order.receipt.payment",
      "order.receipt.totalPaid",
      "order.receipt.history",
      "order.receipt.support",
      "order.receipt.paymentRef",
      "finance.event.payment",
      "finance.event.tip",
      "finance.event.refund",
      "finance.event.wallet_credit",
    ];
    const out: Record<string, string> = {};
    for (const k of keys) {
      out[k] = t(k, k.split(".").pop() ?? k);
    }
    return out;
  }, [t]);

  const refresh = useCallback(async () => {
    if (!entityId) {
      setError(t("order.receipt.missingId", "Missing id"));
      setReceipt(null);
      return;
    }
    setError(null);
    try {
      const data = await fetchReceipt(entityId);
      setReceipt(data);
    } catch (e) {
      setError(
        toUserFacingError(e, t("order.receipt.loadFailed", "Unable to load receipt"))
      );
      setReceipt(null);
    }
  }, [entityId, fetchReceipt, t]);

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
        <ScreenHeader title={t("order.receipt.title", "Receipt")} variant="brand" />
        <View style={styles.loadingWrap}>
          <Image
            source={require("../../assets/brand/mmd-logo-ui.png")}
            style={{ width: logoSize, height: logoSize, borderRadius: logoSize / 2 }}
            resizeMode="contain"
            accessibilityLabel="MMD"
          />
          <Text style={styles.loadingBrand}>MMD DELIVERY</Text>
          <WalletLoadingState label={t("common.loading", "Loading…")} />
        </View>
      </SafeAreaView>
    );
  }

  if (error && !receipt) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <ScreenHeader title={t("order.receipt.title", "Receipt")} variant="brand" />
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
        <ScreenHeader title={t("order.receipt.title", "Receipt")} variant="brand" />
        <WalletEmptyState
          title={t("order.receipt.emptyTitle", "No receipt")}
          body={t("order.receipt.emptyBody", "This order has no receipt yet.")}
        />
      </SafeAreaView>
    );
  }

  const duration =
    receipt.delivery.duration_minutes ?? receipt.delivery.eta_minutes;
  const merchantTitleKey =
    receipt.merchant?.kind === "package"
      ? "order.receipt.package"
      : "order.receipt.restaurant";

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScreenHeader
        title={t("order.receipt.title", "Receipt")}
        subtitle={`${t(entityLabelKey, entityLabelFallback)} #${receipt.invoice.entity_number}`}
        variant="brand"
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={MMD_GOLD_BRIGHT}
          />
        }
      >
        <View style={styles.headerCard} accessibilityRole="header">
          <Image
            source={require("../../assets/brand/mmd-logo-ui.png")}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="MMD"
          />
          <Text style={styles.brand}>{receipt.company.brand}</Text>
          <Text style={styles.legal}>{receipt.company.legal_name}</Text>
          <Text style={styles.meta}>
            {t("order.receipt.invoice", "Invoice")} {receipt.invoice.invoice_number}
          </Text>
          <Text style={styles.meta}>
            {t(entityLabelKey, entityLabelFallback)} {receipt.invoice.entity_number}
          </Text>
          <Text style={styles.meta}>
            {formatDateTime(receipt.invoice.issued_at, lang)}
          </Text>
          <Text style={styles.status}>{receipt.invoice.payment_status}</Text>
        </View>

        <Text style={styles.sectionTitle}>
          {t("order.receipt.delivery", "Delivery")}
        </Text>
        {receipt.delivery.map_static_url ? (
          <Image
            source={{ uri: receipt.delivery.map_static_url }}
            style={styles.map}
            accessibilityLabel={t("order.receipt.tripMap", "Delivery map")}
          />
        ) : (
          <View style={styles.mapFallback}>
            <Text style={styles.meta}>
              {t("order.receipt.mapUnavailable", "Delivery map unavailable")}
            </Text>
          </View>
        )}
        <View style={styles.card}>
          <Text style={styles.label}>{t("order.receipt.pickup", "Pickup")}</Text>
          <Text style={styles.value}>{receipt.delivery.pickup_address}</Text>
          <Text style={[styles.label, { marginTop: 12 }]}>
            {t("order.receipt.dropoff", "Dropoff")}
          </Text>
          <Text style={styles.value}>{receipt.delivery.dropoff_address}</Text>
          <Text style={styles.meta}>
            {formatDistance(receipt.delivery.distance_miles, lang)}
            {" · "}
            {formatDurationMinutes(duration, lang)}
          </Text>
        </View>

        {receipt.merchant ? (
          <>
            <Text style={styles.sectionTitle}>
              {t(
                merchantTitleKey,
                receipt.merchant.kind === "package" ? "Package" : "Restaurant"
              )}
            </Text>
            <View style={styles.cardRow}>
              {receipt.merchant.photo_url ? (
                <Image
                  source={{ uri: receipt.merchant.photo_url }}
                  style={styles.avatar}
                  accessibilityIgnoresInvertColors
                />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.value}>{receipt.merchant.name}</Text>
              </View>
            </View>
          </>
        ) : null}

        {receipt.driver?.name ? (
          <>
            <Text style={styles.sectionTitle}>
              {t("order.receipt.driver", "Driver")}
            </Text>
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
              </View>
            </View>
          </>
        ) : null}

        <Text style={styles.sectionTitle}>
          {t("order.receipt.payment", "Payment")}
        </Text>
        <View style={styles.card}>
          {receipt.fare_lines.map((line) => (
            <View key={line.key} style={styles.fareRow}>
              <Text style={styles.fareLabel}>{t(line.label_key, line.key)}</Text>
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
              {t("order.receipt.totalPaid", "Total paid")}
            </Text>
            <Text style={styles.totalValue}>
              {money(receipt.totals.total_paid_cents)}
            </Text>
          </View>
          <Text style={styles.meta}>
            {[
              receipt.payment.method === "business_wallet"
                ? t("order.receipt.businessWallet", "Business wallet")
                : t("order.receipt.card", "Card"),
              receipt.payment.brand,
              receipt.payment.last4 ? `•••• ${receipt.payment.last4}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          {receipt.payment.payment_intent_id ? (
            <Text style={styles.meta}>
              {t("order.receipt.paymentRef", "Payment ref")}:{" "}
              {receipt.payment.payment_intent_id}
            </Text>
          ) : null}
        </View>

        {receipt.financial_timeline.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>
              {t("order.receipt.history", "Financial history")}
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

        <Text style={styles.sectionTitle}>
          {t("order.receipt.support", "Support")}
        </Text>
        <View style={styles.card}>
          <TouchableOpacity
            onPress={() =>
              Linking.openURL(`mailto:${receipt.company.support_email}`)
            }
            accessibilityRole="link"
          >
            <Text style={styles.link}>{receipt.company.support_email}</Text>
          </TouchableOpacity>
          {receipt.company.support_phone ? (
            <TouchableOpacity
              onPress={() =>
                Linking.openURL(`tel:${receipt.company.support_phone}`)
              }
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
              {t("order.receipt.helpCenter", "Help center")}
            </Text>
          </TouchableOpacity>
          <Text style={styles.meta}>{receipt.invoice.invoice_number}</Text>
        </View>

        <Text style={styles.sectionTitle}>
          {t("order.receipt.actions", "Actions")}
        </Text>
        <View style={styles.actions}>
          <ActionBtn
            label={t("order.receipt.downloadPdf", "Download PDF")}
            onPress={async () => {
              try {
                await printEntityReceiptPdf(
                  receipt,
                  fareLabels,
                  lang,
                  entityLabelKey
                );
              } catch (e) {
                setError(
                  toUserFacingError(
                    e,
                    t("order.receipt.pdfFailed", "Unable to create PDF")
                  )
                );
              }
            }}
          />
          <ActionBtn
            label={t("order.receipt.share", "Share")}
            onPress={() =>
              Share.share({
                message: `${receipt.company.brand} ${receipt.invoice.invoice_number}\n${receipt.invoice.qr_url}`,
                url: receipt.invoice.qr_url,
              })
            }
          />
          <ActionBtn
            label={t("order.receipt.contactSupport", "Contact support")}
            onPress={() =>
              Linking.openURL(
                `mailto:${receipt.company.support_email}?subject=${encodeURIComponent(receipt.invoice.invoice_number)}`
              )
            }
          />
        </View>
      </ScrollView>
      {hideCustomerNav ? null : (
        <ClientServiceBottomNav active="orders" appearance="glass" accent="gold" layout="edge" />
      )}
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
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 8,
  },
  loadingBrand: {
    color: MMD_WHITE,
    fontSize: 22,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
    marginBottom: 8,
  },
  content: { padding: 20, paddingBottom: 120 },
  headerCard: {
    backgroundColor: MMD_GLASS,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
    padding: 16,
    marginBottom: 16,
    alignItems: "flex-start",
  },
  logo: { width: 72, height: 72, borderRadius: 36, marginBottom: 8, alignSelf: "center" },
  brand: {
    color: MMD_WHITE,
    fontSize: 28,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
  },
  legal: {
    color: "#94A3B8",
    marginTop: 4,
    fontWeight: "600",
    fontFamily: MMD_FONT.semibold,
    fontSize: 13,
  },
  meta: {
    color: "#94A3B8",
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: MMD_FONT.regular,
  },
  status: {
    marginTop: 10,
    color: "#22C55E",
    fontWeight: "800",
    textTransform: "uppercase",
    fontSize: 12,
    fontFamily: MMD_FONT.extrabold,
  },
  sectionTitle: {
    color: "#94A3B8",
    fontWeight: "800",
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 8,
    marginTop: 8,
    fontFamily: MMD_FONT.extrabold,
  },
  card: {
    backgroundColor: MMD_GLASS,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
    padding: 16,
    marginBottom: 14,
  },
  cardRow: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: MMD_GLASS,
    borderRadius: 16,
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
    backgroundColor: MMD_BLUE,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
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
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: { backgroundColor: "#E5E7EB" },
  label: {
    color: "#94A3B8",
    fontWeight: "700",
    fontSize: 12,
    fontFamily: MMD_FONT.bold,
  },
  value: {
    color: MMD_WHITE,
    fontWeight: "700",
    marginTop: 4,
    lineHeight: 20,
    fontFamily: MMD_FONT.bold,
  },
  fareRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(148,163,184,0.14)",
  },
  fareLabel: { color: MMD_WHITE, flex: 1, paddingRight: 12, fontFamily: MMD_FONT.regular },
  fareAmount: { color: MMD_WHITE, fontWeight: "800", fontFamily: MMD_FONT.extrabold },
  discount: { color: "#22C55E" },
  totalRow: { borderBottomWidth: 0, marginTop: 4 },
  totalLabel: {
    color: MMD_WHITE,
    fontWeight: "800",
    fontSize: 16,
    fontFamily: MMD_FONT.extrabold,
  },
  totalValue: {
    color: MMD_WHITE,
    fontWeight: "800",
    fontSize: 16,
    fontFamily: MMD_FONT.extrabold,
  },
  link: { color: "#93C5FD", fontWeight: "700", marginTop: 8, fontFamily: MMD_FONT.bold },
  actions: { gap: 10, marginBottom: 24 },
  actionBtn: {
    backgroundColor: MMD_TAXI_GREEN,
    borderWidth: 0,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    minHeight: 48,
    justifyContent: "center",
  },
  actionText: {
    color: MMD_WHITE,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
    fontSize: 14,
  },
});
