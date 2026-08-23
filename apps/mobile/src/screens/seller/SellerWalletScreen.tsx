import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  StyleSheet,
  Alert,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { loadOwnSeller } from "../../lib/sellerApi";
import { getApiBaseUrl } from "../../lib/apiBase";
import { formatWalletAmount, fetchWalletSummary, requestWalletCashOut } from "../../lib/walletApi";
import { startStripeOnboarding } from "../../utils/stripe";
import { toUserFacingError } from "../../lib/userFacingError";
import { formatDateTime } from "../../i18n/formatters";
import {
  normalizeStripeConnectStatus,
  stripeConnectStatusLabel,
  stripeConnectUserMessage,
} from "../../lib/stripeConnectStatus";
import {
  SellerBottomNav,
  SellerBrandHeader,
  SellerContentWrap,
  SellerFeedbackCard,
  SellerGlassCard,
} from "../../components/seller/SellerChrome";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GLASS,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../../theme/mmdUi";

type ActivityItem = {
  id: string;
  kind: string;
  status: string;
  amount_cents: number;
  currency: string;
  direction: string;
  title: string;
  subtitle: string | null;
  platform_fee_cents: number | null;
  stripe_transfer_id: string | null;
  stripe_refund_id: string | null;
  created_at: string;
};

export default function SellerWalletScreen() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<any>();
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
  const [feesCents, setFeesCents] = useState(0);
  const [refundedCents, setRefundedCents] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [stripeLabel, setStripeLabel] = useState(
    stripeConnectStatusLabel("setup_required")
  );
  const [stripeMessage, setStripeMessage] = useState(
    stripeConnectUserMessage("setup_required")
  );

  const fmt = useCallback(
    (cents: number) => formatWalletAmount(cents, currency),
    [currency]
  );

  const buckets = useMemo(() => {
    const pending = items.filter((i) =>
      ["pending", "approved", "processing"].includes(i.status.toLowerCase())
    );
    const paid = items.filter((i) => i.status.toLowerCase() === "paid");
    const refunds = items.filter((i) => i.kind === "refund");
    return { pending, paid, refunds };
  }, [items]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Session expired");

      const seller = await loadOwnSeller();
      const countryCode = seller?.country_code?.trim().toUpperCase() || "US";

      const base = getApiBaseUrl().replace(/\/$/, "");
      const [summary, activityRes, connectRes] = await Promise.all([
        fetchWalletSummary(token, { accountType: "seller", countryCode }),
        fetch(`${base}/api/wallet/seller-activity?limit=50`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then(async (r) => {
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(String(j.error ?? `HTTP ${r.status}`));
          return j as { items?: ActivityItem[] };
        }),
        supabase.functions.invoke("check_connect_status", {
          body: { role: "seller" },
        }),
      ]);

      if (!summary.ok) throw new Error(summary.error ?? "wallet_summary_failed");

      setCurrency(String(summary.currency ?? "USD"));
      setBalanceCents(Number(summary.balance_cents ?? 0));
      setAvailableCents(Number(summary.available_cents ?? 0));
      setAwaitingCents(
        Number(summary.awaiting_transfer_cents ?? summary.pending_cents ?? 0)
      );
      setPaidOutCents(Number(summary.paid_out_cents ?? 0));
      setMinimumPayoutCents(Number(summary.minimum_payout_cents ?? 2000));
      setCanCashout(Boolean(summary.can_cashout));
      setCashoutBlockReason(summary.cashout_block_reason ?? null);
      setFeesCents(Number(summary.platform_fees_cents ?? 0));
      setRefundedCents(Number(summary.refunded_cents ?? 0));
      setNote(summary.note ?? null);
      setItems(activityRes.items ?? []);

      const connect = connectRes.data as {
        status?: string;
        status_label?: string;
      } | null;
      if (!connectRes.error && connect) {
        const code = normalizeStripeConnectStatus(connect.status);
        setStripeLabel(
          String(connect.status_label ?? "") || stripeConnectStatusLabel(code)
        );
        setStripeMessage(stripeConnectUserMessage(code));
      }
    } catch (e) {
      setError(
        toUserFacingError(
          e,
          t("seller.wallet.loadFailed", "Unable to load seller wallet")
        )
      );
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void refresh().finally(() => setLoading(false));
    }, [refresh])
  );

  const onPressCashout = useCallback(async () => {
    if (loading || cashoutInFlight || !canCashout) return;

    Alert.alert(
      t("seller.wallet.cashoutConfirmTitle", "Instant cash out"),
      t(
        "seller.wallet.cashoutConfirmBody",
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
                accountType: "seller",
                currency,
                source: "mobile_wallet_cashout",
              });

              if (!payload.ok || payload.error) {
                throw new Error(payload.error ?? "cashout_failed");
              }

              Alert.alert(
                t("seller.wallet.cashoutRequested", "Cash out requested"),
                t("seller.wallet.cashoutAmount", "Amount: {{amount}}", {
                  amount: fmt(payload.payout_amount_cents ?? availableCents),
                })
              );
              await refresh();
            } catch (e) {
              Alert.alert(
                t("common.errorTitle", "Error"),
                toUserFacingError(
                  e,
                  t("seller.wallet.cashoutFailed", "Unable to request cash out.")
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
    availableCents,
    minimumPayoutCents,
    currency,
    fmt,
    refresh,
    t,
  ]);

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
        <StatusBar barStyle="light-content" />
        <SellerBrandHeader
          subtitle={t("seller.wallet.title", "Wallet")}
          showBack
          fallbackRoute="SellerDashboard"
        />
        <SellerFeedbackCard
          loading
          title={t("common.loading", "Loading...")}
          message={t("seller.wallet.loading", "Fetching your wallet")}
        />
        <SellerBottomNav active="earnings" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
        <StatusBar barStyle="light-content" />
        <SellerBrandHeader
          subtitle={t("seller.wallet.title", "Wallet")}
          showBack
          fallbackRoute="SellerDashboard"
        />
        <SellerFeedbackCard
          icon="⚠️"
          title={t("seller.wallet.errorTitle", "Wallet Error")}
          message={error}
          actionLabel={t("common.retry", "Retry")}
          actionTone="red"
          onAction={() => {
            setLoading(true);
            void refresh().finally(() => setLoading(false));
          }}
        />
        <SellerBottomNav active="earnings" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" />
      <SellerBrandHeader
        subtitle={t("seller.wallet.title", "Wallet")}
        showBack
        fallbackRoute="SellerDashboard"
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={MMD_WHITE}
            onRefresh={() => {
              setRefreshing(true);
              void refresh().finally(() => setRefreshing(false));
            }}
          />
        }
      >
        <SellerContentWrap style={{ gap: 16 }}>
        <SellerGlassCard style={styles.hero}>
          <Text style={styles.heroLabel}>
            {t("seller.wallet.available", "Available Balance")}
          </Text>
          <Text style={styles.heroAmount}>
            {fmt(availableCents || balanceCents)}
          </Text>
          <Text style={styles.heroMeta}>
            {t("seller.wallet.awaiting", "Awaiting transfer")}: {fmt(awaitingCents)}
          </Text>
          {note ? <Text style={styles.heroMeta}>{note}</Text> : null}
          <Text style={styles.heroMeta}>
            {t("seller.wallet.cashoutRules", "Minimum {{min}} • 1 cash out / day", {
              min: fmt(minimumPayoutCents),
            })}
          </Text>
          <TouchableOpacity
            style={[
              styles.payoutBtn,
              (!canCashout || cashoutInFlight) && styles.payoutBtnDisabled,
            ]}
            onPress={() => void onPressCashout()}
            disabled={!canCashout || cashoutInFlight || loading}
            accessibilityRole="button"
          >
            <Text style={styles.payoutLabel}>
              {cashoutInFlight
                ? t("shared.common.loadingEllipsis", "…")
                : t("seller.wallet.cashOut", "Cash out")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.manageBtn}
            onPress={() => {
              void startStripeOnboarding("seller").catch((e) =>
                Alert.alert(
                  t("common.errorTitle", "Error"),
                  toUserFacingError(
                    e,
                    t("seller.wallet.stripeFailed", "Unable to open Stripe.")
                  )
                )
              );
            }}
            accessibilityRole="button"
          >
            <Text style={styles.manageBtnLabel}>
              {t("seller.wallet.manageConnect", "Manage payouts")}
            </Text>
          </TouchableOpacity>
        </SellerGlassCard>

        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>{t("seller.wallet.paidOut", "Paid out")}</Text>
            <Text style={styles.statValue}>{fmt(paidOutCents)}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>{t("seller.wallet.fees", "Commissions")}</Text>
            <Text style={styles.statValue}>{fmt(feesCents)}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>{t("seller.wallet.refunds", "Refunds")}</Text>
            <Text style={styles.statValue}>{fmt(refundedCents)}</Text>
          </View>
        </View>

        <SellerGlassCard style={{ gap: 8 }}>
          <Text style={styles.sectionTitle}>
            {t("seller.wallet.connect", "Stripe Connect")}
          </Text>
          <Text style={styles.statValue}>{stripeLabel}</Text>
          <Text style={styles.heroMeta}>{stripeMessage}</Text>
        </SellerGlassCard>

        <Text style={styles.sectionTitle}>
          💸 {t("seller.wallet.activity", "Recent Transactions")}
        </Text>
        <Text style={styles.heroMeta}>
          {t("seller.wallet.buckets", "Pending {{p}} · Paid {{paid}} · Refunds {{r}}", {
            p: buckets.pending.length,
            paid: buckets.paid.length,
            r: buckets.refunds.length,
          })}
        </Text>

        {items.length === 0 ? (
          <SellerFeedbackCard
            icon="💳"
            title={t("seller.wallet.emptyTitle", "No Payouts Yet")}
            message={t(
              "seller.wallet.emptyBody",
              "Payouts will appear here after your sales settle"
            )}
            actionLabel={t("seller.wallet.viewOrders", "View orders")}
            onAction={() => navigation.navigate("SellerOrders")}
          />
        ) : (
          items.map((item) => {
            const credit = item.direction === "credit";
            return (
              <SellerGlassCard key={item.id} style={styles.txRow}>
                <View
                  style={[
                    styles.txIcon,
                    { backgroundColor: credit ? MMD_TAXI_GREEN : "#EF4444" },
                  ]}
                >
                  <Text>{credit ? "🟢" : "🔴"}</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.txTitle}>{item.title}</Text>
                  <Text style={styles.heroMeta}>
                    {item.subtitle ||
                      `${formatDateTime(item.created_at, i18n.language)} · ${item.status}`}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.txAmount,
                    { color: credit ? MMD_TAXI_GREEN : "#EF4444" },
                  ]}
                >
                  {credit ? "+" : "−"}
                  {fmt(item.amount_cents)}
                </Text>
              </SellerGlassCard>
            );
          })
        )}
        </SellerContentWrap>
      </ScrollView>

      <SellerBottomNav active="earnings" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MMD_BLUE },
  content: { padding: 24, paddingBottom: 40, gap: 16 },
  hero: { gap: 12, padding: 28, borderRadius: 28 },
  heroLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
  },
  heroAmount: {
    color: MMD_WHITE,
    fontSize: 36,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  heroMeta: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
    lineHeight: 18,
  },
  payoutBtn: {
    marginTop: 4,
    backgroundColor: MMD_TAXI_GREEN,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
  },
  payoutBtnDisabled: {
    opacity: 0.55,
  },
  payoutLabel: {
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  manageBtn: {
    marginTop: 8,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  manageBtnLabel: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  statRow: { flexDirection: "row", gap: 10 },
  stat: {
    flex: 1,
    backgroundColor: MMD_GLASS,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    padding: 12,
  },
  statLabel: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 11,
    fontFamily: MMD_FONT.regular,
  },
  statValue: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    marginTop: 4,
    fontSize: 14,
  },
  sectionTitle: {
    color: MMD_WHITE,
    fontSize: 18,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 20,
    padding: 18,
  },
  txIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  txTitle: {
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  txAmount: {
    fontSize: 18,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
});
