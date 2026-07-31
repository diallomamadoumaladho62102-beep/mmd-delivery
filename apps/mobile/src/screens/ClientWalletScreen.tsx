import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../components/navigation/ScreenHeader";
import {
  WalletEmptyState,
  WalletErrorState,
  WalletHistoryRow,
  WalletLoadingState,
  WalletSummaryCard,
} from "../components/wallet/WalletPrimitives";
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
import { APP_COLORS } from "../theme/appTheme";

/**
 * Client spend wallet — MMD credit for checkout discounts.
 * No Connect cashout / top-up (Business wallet only).
 */
export default function ClientWalletScreen() {
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation();
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
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Session expired");

      const [summary, history] = await Promise.all([
        fetchWalletSummary(token, {
          accountType: "client",
          countryCode: "US",
        }),
        fetchWalletHistory(token, {
          accountType: "client",
          limit: 50,
        }),
      ]);

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
        await refresh();
        if (alive) setLoading(false);
      })();
      return () => {
        alive = false;
      };
    }, [refresh])
  );

  if (loading && items.length === 0 && !error) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <ScreenHeader title={t("client.wallet.title", "Wallet")} />
        <WalletLoadingState label={t("common.loading", "Loading…")} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScreenHeader title={t("client.wallet.title", "Wallet")} />
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
            tintColor={APP_COLORS.accent}
          />
        }
      >
        {error ? (
          <WalletErrorState
            message={error}
            retryLabel={t("common.retry", "Retry")}
            onRetry={() => void refresh()}
          />
        ) : null}

        <WalletSummaryCard
          label={t("client.wallet.available", "Available credit")}
          amount={fmt(availableCents)}
          footnote={note}
        >
          <View style={styles.stats}>
            <Text style={styles.stat}>
              {t("client.wallet.ledgerBalance", "Ledger balance")}: {fmt(balanceCents)}
            </Text>
            <Text style={styles.stat}>
              {t("client.wallet.refunded", "Refunded")}: {fmt(refundedCents)}
            </Text>
          </View>
        </WalletSummaryCard>

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
          <WalletEmptyState
            title={t("client.wallet.emptyTitle", "No activity yet")}
            body={t(
              "client.wallet.emptyBody",
              "Charges, refunds, and credit activity will appear here."
            )}
          />
        ) : (
          items.map((item) => (
            <WalletHistoryRow
              key={item.id}
              title={item.description || item.reference_type}
              meta={formatDateTime(item.created_at, i18n.language)}
              amount={`${item.direction === "debit" ? "−" : "+"}${fmt(item.amount_cents)}`}
              amountColor={financialStatusColor(
                item.direction === "debit" ? "pending" : "paid"
              )}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#020617" },
  content: { padding: 16, paddingBottom: 40 },
  stats: { marginTop: 12, gap: 4 },
  stat: { color: "#94A3B8", fontSize: 12 },
  section: {
    color: "#94A3B8",
    fontWeight: "800",
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 8,
    marginTop: 8,
  },
  loyaltyCta: {
    marginTop: 4,
    marginBottom: 8,
    backgroundColor: "#1D4ED8",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  loyaltyCtaText: { color: "#FFFFFF", fontWeight: "900", fontSize: 15 },
  mutedExplain: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    marginBottom: 12,
  },
});
