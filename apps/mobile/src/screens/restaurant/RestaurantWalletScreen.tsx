import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import { RestaurantBrandLoadingState } from "../../components/restaurant/RestaurantBrandLoadingState";
import { supabase } from "../../lib/supabase";
import {
  fetchWalletHistory,
  fetchWalletSummary,
  formatWalletAmount,
  requestWalletCashOut,
  type WalletLedgerEntry,
} from "../../lib/walletApi";
import { formatDateTime } from "../../i18n/formatters";
import { toUserFacingError } from "../../lib/userFacingError";
import { RestaurantStripeConnectCard } from "../../features/restaurant/components/RestaurantStripeConnectCard";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GLASS,
  MMD_TAXI_GREEN,
  MMD_TEXT,
  MMD_WHITE,
} from "../../theme/mmdUi";

const CARD_BORDER = "rgba(255,255,255,0.12)";
const MUTED = "rgba(255,255,255,0.7)";
const DEBIT = "#FCA5A5";

/**
 * Restaurant wallet — Figma Lot 5 (348:7083 Loading / 348:7094 Empty /
 * 348:7105 Error / 348:7118 Populated). Keeps summary/history wallet APIs.
 */
export default function RestaurantWalletScreen() {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [cashoutInFlight, setCashoutInFlight] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [balanceCents, setBalanceCents] = useState(0);
  const [availableCents, setAvailableCents] = useState(0);
  const [awaitingCents, setAwaitingCents] = useState(0);
  const [paidOutCents, setPaidOutCents] = useState(0);
  const [minimumPayoutCents, setMinimumPayoutCents] = useState(2000);
  const [canCashout, setCanCashout] = useState(false);
  const [cashoutBlockReason, setCashoutBlockReason] = useState<string | null>(null);
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
      setMinimumPayoutCents(Number(summary.minimum_payout_cents ?? 2000));
      setCanCashout(Boolean(summary.can_cashout));
      setCashoutBlockReason(summary.cashout_block_reason ?? null);
      setNote(summary.note ?? null);
      setItems(history.items ?? []);
    } catch (e) {
      setError(
        toUserFacingError(
          e,
          t("restaurant.wallet.loadFailed", "Unable to load wallet activity.")
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

  const lastPayoutLabel = useMemo(() => {
    const payout = items.find(
      (i) =>
        i.direction === "debit" &&
        /payout/i.test(String(i.description || i.reference_type || ""))
    );
    if (!payout?.created_at) {
      if (paidOutCents > 0) {
        return t("restaurant.wallet.paidOutHint", "Paid out: {{amount}}", {
          amount: fmt(paidOutCents),
        });
      }
      if (note) return note;
      if (awaitingCents > 0) {
        return t("restaurant.wallet.awaitingHint", "Awaiting transfer: {{amount}}", {
          amount: fmt(awaitingCents),
        });
      }
      return null;
    }
    return t("restaurant.wallet.lastPayoutAt", "Last payout {{when}}", {
      when: formatDateTime(payout.created_at, i18n.language),
    });
  }, [items, paidOutCents, note, awaitingCents, fmt, t, i18n.language]);

  const onPressCashout = useCallback(async () => {
    if (loading || cashoutInFlight || !canCashout) {
      if (cashoutBlockReason === "below_minimum") {
        Alert.alert(
          t("restaurant.wallet.cashoutUnavailable", "Cash out unavailable"),
          t("restaurant.wallet.minCashout", "Minimum cash out: {{min}}.", {
            min: fmt(minimumPayoutCents),
          })
        );
      }
      return;
    }

    Alert.alert(
      t("restaurant.wallet.cashoutConfirmTitle", "Instant cash out"),
      t(
        "restaurant.wallet.cashoutConfirmBody",
        "Cash out your full available balance: {{amount}}.\n\nMinimum {{min}} • 1 cash out / day.",
        { amount: fmt(availableCents), min: fmt(minimumPayoutCents) }
      ),
      [
        { text: t("common.cancel", "Cancel"), style: "cancel" },
        {
          text: t("common.ok", "OK"),
          onPress: async () => {
            if (cashoutInFlight) return;
            try {
              setCashoutInFlight(true);
              const { data: sessionData } = await supabase.auth.getSession();
              const token = sessionData.session?.access_token;
              if (!token) throw new Error("Session expired");

              const payload = await requestWalletCashOut(token, {
                accountType: "restaurant",
                currency,
                source: "mobile_wallet_cashout",
              });

              if (!payload.ok || payload.error) {
                throw new Error(payload.error ?? "cashout_failed");
              }

              Alert.alert(
                t("restaurant.wallet.cashoutRequested", "Cash out requested"),
                t("restaurant.wallet.cashoutAmount", "Amount: {{amount}}", {
                  amount: fmt(payload.payout_amount_cents ?? availableCents),
                })
              );
              await refresh();
            } catch (e) {
              Alert.alert(
                t("common.errorTitle", "Error"),
                toUserFacingError(
                  e,
                  t("restaurant.wallet.cashoutFailed", "Unable to request cash out.")
                )
              );
            } finally {
              setCashoutInFlight(false);
            }
          },
        },
      ]
    );
  }, [
    loading,
    cashoutInFlight,
    canCashout,
    cashoutBlockReason,
    minimumPayoutCents,
    availableCents,
    currency,
    fmt,
    refresh,
    t,
  ]);

  if (loading && items.length === 0 && !error) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <ScreenHeader
          title={t("restaurant.wallet.title", "Wallet")}
          subtitle="💰"
          variant="mmd"
        />
        <RestaurantBrandLoadingState
          glass
          title={t("restaurant.wallet.loadingTitle", "Loading Wallet...")}
          subtitle={t(
            "restaurant.wallet.loadingSubtitle",
            "Fetching your balance data"
          )}
        />
      </SafeAreaView>
    );
  }

  if (error && items.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <ScreenHeader
          title={t("restaurant.wallet.title", "Wallet")}
          subtitle="💰"
          variant="mmd"
        />
        <View style={styles.centered}>
          <View style={styles.glassCardWide}>
            <Text style={styles.emoji}>❌</Text>
            <Text style={styles.cardTitle}>
              {t("restaurant.wallet.errorTitle", "Wallet Error")}
            </Text>
            <Text style={styles.cardBody}>
              {error ||
                t(
                  "restaurant.wallet.errorBody",
                  "Unable to load wallet activity."
                )}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.cta}
            onPress={() => {
              setLoading(true);
              void refresh().finally(() => setLoading(false));
            }}
            accessibilityRole="button"
          >
            <Text style={styles.ctaLabel}>{t("common.retry", "Retry")}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const empty = items.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScreenHeader
        title={t("restaurant.wallet.title", "Wallet")}
        subtitle="💰"
        variant="mmd"
      />
      {empty ? (
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
              tintColor={MMD_WHITE}
            />
          }
        >
          <RestaurantStripeConnectCard
            heldAmountLabel={awaitingCents > 0 ? fmt(awaitingCents) : null}
          />
          <View style={styles.glassCard}>
            <Text style={styles.emoji}>💳</Text>
            <Text style={styles.cardTitle}>
              {t("restaurant.wallet.emptyTitle", "No Activity Yet")}
            </Text>
            <Text style={styles.cardBody}>
              {t(
                "restaurant.wallet.emptyBody",
                "Payouts and wallet activity will appear here."
              )}
            </Text>
          </View>
        </ScrollView>
      ) : (
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
              tintColor={MMD_WHITE}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <RestaurantStripeConnectCard
            heldAmountLabel={awaitingCents > 0 ? fmt(awaitingCents) : null}
          />
          <View style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>
              {t("restaurant.wallet.available", "Available")}
            </Text>
            <Text style={styles.balanceAmount}>
              {fmt(availableCents || balanceCents)}
            </Text>
            {lastPayoutLabel ? (
              <Text style={styles.balanceFoot}>{lastPayoutLabel}</Text>
            ) : null}
            <Text style={styles.balanceFoot}>
              {t(
                "restaurant.wallet.cashoutRules",
                "Minimum {{min}} • 1 cash out / day",
                { min: fmt(minimumPayoutCents) }
              )}
            </Text>
            <TouchableOpacity
              style={[
                styles.cashoutBtn,
                (!canCashout || cashoutInFlight) && styles.cashoutBtnDisabled,
              ]}
              onPress={() => void onPressCashout()}
              disabled={!canCashout || cashoutInFlight || loading}
              accessibilityRole="button"
            >
              <Text style={styles.cashoutBtnLabel}>
                {cashoutInFlight
                  ? t("shared.common.loadingEllipsis", "…")
                  : t("restaurant.wallet.cashOut", "Cash out")}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.section}>
            📋 {t("restaurant.wallet.recentTransactions", "Recent Transactions")}
          </Text>
          {items.map((item) => {
            const debit = item.direction === "debit";
            return (
              <View key={item.id} style={styles.txRow}>
                <View style={styles.txLeft}>
                  <Text style={styles.txTitle} numberOfLines={1}>
                    {item.description || item.reference_type}
                  </Text>
                  <Text style={styles.txMeta}>
                    {formatDateTime(item.created_at, i18n.language)}
                  </Text>
                </View>
                <Text style={[styles.txAmount, { color: debit ? DEBIT : MMD_TAXI_GREEN }]}>
                  {debit ? "−" : "+"}
                  {fmt(item.amount_cents)}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 32,
  },
  content: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40, gap: 12 },
  glassCard: {
    width: 280,
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
    gap: 24,
  },
  glassCardWide: {
    width: "100%",
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
    gap: 16,
  },
  emoji: { fontSize: 40, color: MMD_WHITE },
  cardTitle: {
    color: MMD_TEXT,
    fontSize: 20,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    textAlign: "center",
  },
  cardBody: {
    color: MUTED,
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
    textAlign: "center",
  },
  cta: {
    backgroundColor: MMD_TAXI_GREEN,
    minHeight: 44,
    paddingHorizontal: 48,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaLabel: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  balanceCard: {
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 20,
    padding: 24,
    gap: 8,
    marginBottom: 12,
  },
  balanceLabel: {
    color: MUTED,
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
  },
  balanceAmount: {
    color: MMD_WHITE,
    fontSize: 32,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  balanceFoot: {
    color: MMD_TAXI_GREEN,
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
  },
  cashoutBtn: {
    marginTop: 12,
    backgroundColor: MMD_TAXI_GREEN,
    minHeight: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  cashoutBtnDisabled: {
    opacity: 0.55,
  },
  cashoutBtnLabel: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  section: {
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    marginBottom: 4,
  },
  txRow: {
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  txLeft: { flex: 1, gap: 2 },
  txTitle: {
    color: MMD_WHITE,
    fontSize: 15,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  txMeta: {
    color: MUTED,
    fontSize: 12,
    fontFamily: MMD_FONT.regular,
  },
  txAmount: {
    fontSize: 15,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
});
