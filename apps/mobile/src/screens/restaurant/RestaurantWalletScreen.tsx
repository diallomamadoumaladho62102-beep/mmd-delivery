import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import {
  WalletEmptyState,
  WalletErrorState,
  WalletHistoryRow,
  WalletLoadingState,
  WalletSummaryCard,
} from "../../components/wallet/WalletPrimitives";
import { financialStatusColor } from "../../components/wallet/walletStatusColor";
import { supabase } from "../../lib/supabase";
import {
  fetchWalletHistory,
  fetchWalletSummary,
  formatWalletAmount,
  type WalletLedgerEntry,
} from "../../lib/walletApi";
import { formatDateTime } from "../../i18n/formatters";
import { toUserFacingError } from "../../lib/userFacingError";
import { APP_COLORS } from "../../theme/appTheme";

/**
 * Restaurant wallet — same summary/history APIs + shared UI primitives
 * as Seller/Driver (unified wallet architecture).
 */
export default function RestaurantWalletScreen() {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [balanceCents, setBalanceCents] = useState(0);
  const [availableCents, setAvailableCents] = useState(0);
  const [awaitingCents, setAwaitingCents] = useState(0);
  const [paidOutCents, setPaidOutCents] = useState(0);
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
          accountType: "restaurant",
          countryCode: "US",
        }),
        fetchWalletHistory(token, {
          accountType: "restaurant",
          limit: 50,
        }),
      ]);

      setCurrency(String(summary.currency ?? "USD"));
      setBalanceCents(Number(summary.balance_cents ?? 0));
      setAvailableCents(Number(summary.available_cents ?? 0));
      setAwaitingCents(Number(summary.awaiting_transfer_cents ?? 0));
      setPaidOutCents(Number(summary.paid_out_cents ?? 0));
      setNote(summary.note ?? null);
      setItems(history.items ?? []);
    } catch (e) {
      setError(
        toUserFacingError(
          e,
          t("restaurant.wallet.loadFailed", "Unable to load restaurant wallet")
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

  const buckets = useMemo(() => {
    const pending = items.filter((i) =>
      ["pending", "processing"].includes(String(i.reference_type).toLowerCase())
    );
    return { pending, all: items };
  }, [items]);

  if (loading && items.length === 0 && !error) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <ScreenHeader title={t("restaurant.wallet.title", "Restaurant wallet")} />
        <WalletLoadingState label={t("common.loading", "Loading…")} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScreenHeader title={t("restaurant.wallet.title", "Restaurant wallet")} />
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
          label={t("restaurant.wallet.available", "Available")}
          amount={fmt(availableCents || balanceCents)}
          footnote={note}
        >
          <View style={styles.stats}>
            <Text style={styles.stat}>
              {t("restaurant.wallet.awaiting", "Awaiting transfer")}:{" "}
              {fmt(awaitingCents)}
            </Text>
            <Text style={styles.stat}>
              {t("restaurant.wallet.paidOut", "Paid out")}: {fmt(paidOutCents)}
            </Text>
          </View>
        </WalletSummaryCard>

        <Text style={styles.section}>
          {t("restaurant.wallet.history", "History")}
        </Text>
        {buckets.all.length === 0 ? (
          <WalletEmptyState
            title={t("restaurant.wallet.emptyTitle", "No activity yet")}
            body={t(
              "restaurant.wallet.emptyBody",
              "Completed orders and payouts will appear here."
            )}
          />
        ) : (
          buckets.all.map((item) => (
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
});
