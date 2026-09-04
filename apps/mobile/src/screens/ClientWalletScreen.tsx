import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  StatusBar,
  Image,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { SafeLinearGradient as LinearGradient } from "../components/SafeLinearGradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { WalletHistoryRow } from "../components/wallet/WalletPrimitives";
import { financialStatusColor } from "../components/wallet/walletStatusColor";
import { supabase } from "../lib/supabase";
import {
  fetchWalletHistory,
  fetchWalletSummary,
  formatWalletAmount,
  type WalletLedgerEntry,
} from "../lib/walletApi";
import { formatDateTime } from "../i18n/formatters";
import { toUserFacingError } from "../lib/userFacingError";
import { signOutToRoleSelect } from "../lib/signOutToRoleSelect";
import {
  CLIENT_SCREEN_FETCH_TIMEOUT_MS,
  withTimeout,
} from "../lib/bootFailOpen";
import {
  MMD_BLUE,
  MMD_CARD_BORDER,
  MMD_FONT,
  MMD_GOLD_BRIGHT,
  MMD_GOLD_DARK,
  MMD_MUTED,
  MMD_NAVY,
  MMD_WHITE,
  mmdLogoSize,
  mmdLogoSizeCompact,
} from "../theme/mmdUi";

const MMD_LOGO = require("../../assets/brand/mmd-logo-ui.png");

/**
 * Client spend wallet — MMD credit for checkout discounts.
 * No Connect cashout / top-up (Business wallet only).
 */
export default function ClientWalletScreen() {
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation();
  const { width, height } = useWindowDimensions();
  const logoHero = mmdLogoSize(width, height);
  const logoCompact = mmdLogoSizeCompact(width, height);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [availableCents, setAvailableCents] = useState(0);
  const [balanceCents, setBalanceCents] = useState(0);
  const [refundedCents, setRefundedCents] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [items, setItems] = useState<WalletLedgerEntry[]>([]);

  const fmt = useCallback(
    (cents: number) => formatWalletAmount(cents, currency),
    [currency]
  );

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const { data: sessionData } = await withTimeout(
        supabase.auth.getSession(),
        CLIENT_SCREEN_FETCH_TIMEOUT_MS,
        "client_wallet_session",
      );
      const token = sessionData.session?.access_token;
      if (!token) {
        await signOutToRoleSelect(navigation);
        return;
      }

      const [summary, history] = await withTimeout(
        Promise.all([
          fetchWalletSummary(token, {
            accountType: "client",
            countryCode: "US",
          }),
          fetchWalletHistory(token, {
            accountType: "client",
            limit: 50,
          }),
        ]),
        CLIENT_SCREEN_FETCH_TIMEOUT_MS,
        "client_wallet_fetch",
      );

      setCurrency(String(summary.currency ?? "USD"));
      setAvailableCents(Number(summary.available_cents ?? 0));
      setBalanceCents(Number(summary.balance_cents ?? 0));
      setRefundedCents(Number(summary.refunded_cents ?? 0));
      setNote(
        summary.note ??
          t(
            "client.wallet.defaultNote",
            "MMD credit applies as checkout discounts. Ledger shows charges and refunds — no cashout or top-up here."
          )
      );
      setItems(history.items ?? []);
    } catch (e) {
      setError(
        toUserFacingError(
          e,
          t("client.wallet.loadFailed", "Unable to load wallet")
        )
      );
      setItems([]);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        setLoading(true);
        try {
          await refresh();
        } finally {
          if (alive) setLoading(false);
        }
      })();
      return () => {
        alive = false;
      };
    }, [refresh])
  );

  if (loading && items.length === 0 && !error) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
        <ScreenHeader title={t("client.wallet.title", "Wallet")} variant="dark" />
        <View style={styles.splashBody}>
          <Image
            source={MMD_LOGO}
            style={{
              width: logoHero,
              height: logoHero,
              borderRadius: logoHero / 2,
            }}
            resizeMode="contain"
            accessibilityLabel="MMD Delivery"
          />
          <Text style={styles.brandTitle}>MMD DELIVERY</Text>
          <Text style={styles.tagline}>
            {t("brand.tagline", "We Deliver With Heart ❤️")}
          </Text>
          <ActivityIndicator color={MMD_GOLD_BRIGHT} style={{ marginTop: 8 }} />
        </View>
      </SafeAreaView>
    );
  }

  if (error && items.length === 0 && !loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
        <View style={styles.splashBody}>
          <Image
            source={MMD_LOGO}
            style={{
              width: logoHero,
              height: logoHero,
              borderRadius: logoHero / 2,
            }}
            resizeMode="contain"
            accessibilityLabel="MMD Delivery"
          />
          <Text style={styles.brandTitle}>MMD DELIVERY</Text>
          <Text style={styles.tagline}>
            {t("brand.tagline", "We Deliver With Heart ❤️")}
          </Text>
          <View style={{ height: 40 }} />
          <Text style={styles.errorTitle}>
            {t("client.wallet.errorTitle", "Couldn’t load wallet")}
          </Text>
          <Text style={styles.errorBody}>
            {error ||
              t(
                "client.wallet.errorBody",
                "Check your connection and try again."
              )}
          </Text>
          <TouchableOpacity
            onPress={() => void refresh()}
            activeOpacity={0.85}
            style={styles.retryOuter}
            accessibilityRole="button"
            accessibilityLabel={t("common.retry", "Retry")}
          >
            <LinearGradient
              colors={[MMD_GOLD_DARK, MMD_GOLD_BRIGHT]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.retryBtn}
            >
              <Text style={styles.retryText}>{t("common.retry", "Retry")}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader title={t("client.wallet.title", "Wallet")} variant="dark" />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await refresh();
              setRefreshing(false);
            }}
            tintColor={MMD_GOLD_BRIGHT}
          />
        }
      >
        <Image
          source={MMD_LOGO}
          style={{
            width: logoCompact,
            height: logoCompact,
            borderRadius: logoCompact / 2,
            alignSelf: "center",
            marginBottom: 8,
          }}
          resizeMode="contain"
          accessibilityLabel="MMD Delivery"
        />

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>
            {t("client.wallet.available", "Available credit")}
          </Text>
          <Text style={styles.summaryAmount}>{fmt(availableCents)}</Text>
          {note ? <Text style={styles.footnote}>{note}</Text> : null}
          <View style={styles.stats}>
            <Text style={styles.stat}>
              {t("client.wallet.ledgerBalance", "Ledger balance")}: {fmt(balanceCents)}
            </Text>
            <Text style={styles.stat}>
              {t("client.wallet.refunded", "Refunded")}: {fmt(refundedCents)}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={() => navigation.navigate("LoyaltyHub", { role: "client" })}
          activeOpacity={0.85}
          style={styles.loyaltyCta}
          accessibilityRole="button"
        >
          <Text style={styles.loyaltyCtaText}>
            {t("client.wallet.openLoyalty", "Points & referrals")}
          </Text>
        </TouchableOpacity>

        <Text style={styles.mutedExplain}>
          {t(
            "client.wallet.noCashout",
            "No cashout, Connect, or top-up on this wallet. Top-up is available on Business wallet only."
          )}
        </Text>

        <Text style={styles.section}>
          {t("client.wallet.history", "History")}
        </Text>
        {items.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>
              {t("client.wallet.emptyTitle", "No activity yet")}
            </Text>
            <Text style={styles.emptyBody}>
              {t(
                "client.wallet.emptyBody",
                "Charges, refunds, and credit activity will appear here."
              )}
            </Text>
          </View>
        ) : (
          <View style={styles.historyCard}>
            {items.map((item) => (
              <WalletHistoryRow
                key={item.id}
                title={item.description || item.reference_type}
                meta={formatDateTime(item.created_at, i18n.language)}
                amount={`${item.direction === "debit" ? "−" : "+"}${fmt(item.amount_cents)}`}
                amountColor={financialStatusColor(
                  item.direction === "debit" ? "pending" : "paid"
                )}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  content: {
    padding: 16,
    paddingBottom: 40,
    alignItems: "stretch",
    gap: 8,
  },
  splashBody: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 12,
  },
  brandTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 28,
    textAlign: "center",
  },
  tagline: {
    color: MMD_GOLD_BRIGHT,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 16,
    textAlign: "center",
  },
  errorTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 18,
    textAlign: "center",
  },
  errorBody: {
    color: MMD_MUTED,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 14,
    textAlign: "center",
  },
  retryOuter: { marginTop: 4 },
  retryBtn: {
    borderRadius: 12,
    paddingHorizontal: 22,
    paddingVertical: 12,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  retryText: {
    color: MMD_NAVY,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
  },
  summaryCard: {
    backgroundColor: MMD_NAVY,
    borderColor: MMD_GOLD_BRIGHT,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 16,
    marginBottom: 6,
  },
  summaryLabel: {
    color: MMD_GOLD_BRIGHT,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 12,
  },
  summaryAmount: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 32,
    marginTop: 6,
  },
  footnote: {
    color: MMD_MUTED,
    fontFamily: MMD_FONT.regular,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 6,
  },
  stats: { marginTop: 6, gap: 4 },
  stat: {
    color: MMD_MUTED,
    fontFamily: MMD_FONT.regular,
    fontSize: 12,
  },
  section: {
    color: MMD_GOLD_BRIGHT,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 4,
    marginTop: 8,
  },
  loyaltyCta: {
    marginTop: 4,
    marginBottom: 4,
    backgroundColor: "#22C55E",
    borderRadius: 10,
    paddingVertical: 14,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  loyaltyCtaText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "700",
    fontSize: 16,
  },
  mutedExplain: {
    color: MMD_MUTED,
    fontSize: 12,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    lineHeight: 18,
    marginBottom: 4,
  },
  emptyBox: {
    backgroundColor: MMD_NAVY,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: MMD_CARD_BORDER,
    padding: 20,
    alignItems: "center",
  },
  emptyTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 20,
    marginBottom: 8,
    textAlign: "center",
  },
  emptyBody: {
    color: MMD_MUTED,
    fontFamily: MMD_FONT.regular,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  historyCard: {
    backgroundColor: MMD_NAVY,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: MMD_CARD_BORDER,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
});
