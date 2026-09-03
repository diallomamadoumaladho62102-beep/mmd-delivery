/**
 * Driver wallet — Stripe Connect cashout.
 * UI: Figma 308:6374 Loading / 308:6393 Empty / 308:6444 Funded Ready / 308:6516 Funded Setup.
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { DriverBrandLoadingState } from "../components/driver/DriverBrandLoadingState";
import { instantCashoutBlockMessage } from "../lib/instantCashoutBlockMessage";
import { supabase } from "../lib/supabase";
import {
  fetchDriverWalletSnapshot,
  formatWalletAmount,
  requestWalletCashOut,
  type PayoutMethodOption,
  type PayoutTransactionItem,
  type WalletLedgerEntry,
} from "../lib/walletApi";
import {
  formatWalletField,
  isFailedPayoutStatus,
  isPaidPayoutStatus,
  isProcessingPayoutStatus,
  payoutStatusLabel,
} from "../lib/walletDisplay";
import { startStripeOnboarding } from "../utils/stripe";
import { logTechnicalError, toUserFacingError } from "../lib/userFacingError";
import {
  isStripeConnectReady,
  normalizeStripeConnectStatus,
  stripeConnectStatusLabel,
  stripeConnectUserMessage,
  type StripeConnectStatusCode,
} from "../lib/stripeConnectStatus";
import { financialStatusColor } from "../components/wallet/walletStatusColor";
import { formatDateTime } from "../i18n/formatters";
import { resolveWalletLinkedJob } from "../lib/walletLinkedJob";
import {
  MMD_ACTION_NAVY,
  MMD_BLUE,
  MMD_FONT,
  MMD_GLASS,
  MMD_GOLD_CLASSIC,
  MMD_GOLD_CLASSIC_BORDER,
  MMD_MUTED,
  MMD_TAXI_GREEN,
  MMD_TEXT,
  MMD_WHITE,
} from "../theme/mmdUi";

const MMD_LOGO = require("../../assets/brand/mmd-logo-ui.png");

const BORDER = "rgba(148,163,184,0.14)";
const LILAC = "#A78BFA";
const AMBER = "#F59E0B";
const RED = "#FCA5A5";
const SLATE = "#64748B";

async function getFunctionErrorPayload(error: any): Promise<{ code?: string; message?: string }> {
  try {
    const context = error?.context;

    if (context && typeof context.json === "function") {
      const parsed = await context.json();
      return {
        code: typeof parsed?.error === "string" ? parsed.error : parsed?.code,
        message:
          (typeof parsed?.message === "string" && parsed.message) ||
          (typeof parsed?.error === "string" && parsed.error) ||
          undefined,
      };
    }

    if (context && typeof context.text === "function") {
      const text = await context.text();
      if (text?.trim()) {
        try {
          const parsed = JSON.parse(text);
          return {
            code: typeof parsed?.error === "string" ? parsed.error : parsed?.code,
            message:
              (typeof parsed?.message === "string" && parsed.message) ||
              (typeof parsed?.error === "string" && parsed.error) ||
              text,
          };
        } catch {
          return { message: text };
        }
      }
    }

    if (typeof error?.context?.body === "string") {
      return { message: error.context.body };
    }

    if (typeof error?.message === "string") {
      return { message: error.message };
    }
  } catch {}

  return { message: "Unable to request cash out." };
}

void getFunctionErrorPayload;

function payoutStatusColor(status: string) {
  return financialStatusColor(status);
}

function BrandFooter({ stacked }: { stacked?: boolean }) {
  return (
    <View style={[styles.footer, stacked && styles.footerStacked]}>
      <Image
        source={MMD_LOGO}
        style={styles.footerLogo}
        resizeMode="contain"
        accessibilityLabel="MMD Delivery"
      />
      <Text style={styles.footerBrand}>MMD Delivery</Text>
    </View>
  );
}

function MetricCard({
  label,
  amount,
  sub,
}: {
  label: string;
  amount: string;
  sub: string;
}) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricAmount}>{amount}</Text>
      <Text style={styles.metricSub}>{sub}</Text>
    </View>
  );
}

export function DriverWalletScreen() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [loading, setLoading] = useState(true);
  const [cashoutInFlight, setCashoutInFlight] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [availableCents, setAvailableCents] = useState(0);
  const [awaitingTransferCents, setAwaitingTransferCents] = useState(0);
  const [settlingCents, setSettlingCents] = useState(0);
  const [confirmedEarningsCents, setConfirmedEarningsCents] = useState(0);
  const [connectAvailableCents, setConnectAvailableCents] = useState(0);
  const [pendingCents, setPendingCents] = useState(0);
  const [ledgerBalanceCents, setLedgerBalanceCents] = useState(0);
  const [instantEligible, setInstantEligible] = useState(false);
  const [minimumPayoutCents, setMinimumPayoutCents] = useState(0);
  const [stripeAccountId, setStripeAccountId] = useState<string | null>(null);
  const [stripeStatus, setStripeStatus] = useState<StripeConnectStatusCode>("setup_required");
  const [stripeStatusLabel, setStripeStatusLabel] = useState(
    stripeConnectStatusLabel("setup_required"),
  );
  const [stripeStatusMessage, setStripeStatusMessage] = useState(
    stripeConnectUserMessage("setup_required"),
  );
  const [canCashout, setCanCashout] = useState(false);
  const [cashoutBlockReason, setCashoutBlockReason] = useState<string | null>(null);
  const [cashoutBlockedToday, setCashoutBlockedToday] = useState<boolean>(false);
  const [lastCashoutAt, setLastCashoutAt] = useState<string | null>(null);
  const [payoutMethods, setPayoutMethods] = useState<PayoutMethodOption[]>([]);
  const [ledgerHistory, setLedgerHistory] = useState<WalletLedgerEntry[]>([]);
  const [payoutTransactions, setPayoutTransactions] = useState<PayoutTransactionItem[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [successCents, setSuccessCents] = useState<number | null>(null);
  const [txFilter, setTxFilter] = useState<"all" | "earnings" | "payouts">("all");

  const localeForDates = i18n.language;

  const fmtMoney = useCallback(
    (cents: number) => formatWalletAmount(cents, currency),
    [currency],
  );

  const payoutBuckets = useMemo(() => {
    const processing = payoutTransactions.filter((item) =>
      isProcessingPayoutStatus(item.status),
    );
    const completed = payoutTransactions.filter((item) =>
      isPaidPayoutStatus(item.status),
    );
    const failed = payoutTransactions.filter((item) =>
      isFailedPayoutStatus(item.status),
    );
    return {
      processingCents: processing.reduce((sum, item) => sum + (item.amount_cents || 0), 0),
      completedCents: completed.reduce((sum, item) => sum + (item.amount_cents || 0), 0),
      failedCents: failed.reduce((sum, item) => sum + (item.amount_cents || 0), 0),
      processingCount: processing.length,
      completedCount: completed.length,
      failedCount: failed.length,
      lastPayout: payoutTransactions[0] ?? null,
    };
  }, [payoutTransactions]);

  const cashoutReason = useMemo(() => {
    if (cashoutBlockReason === "stripe_setup_required" && stripeStatusMessage) {
      return stripeStatusMessage;
    }
    const mapped = instantCashoutBlockMessage(cashoutBlockReason, t, {
      minimumLabel: fmtMoney(minimumPayoutCents),
    });
    if (mapped) return mapped;
    return cashoutBlockReason
      ? toUserFacingError({ code: cashoutBlockReason }, "")
      : "";
  }, [cashoutBlockReason, minimumPayoutCents, fmtMoney, t, stripeStatusMessage]);

  const applyStripeStatus = useCallback(
    (codeRaw: unknown, label?: string | null, message?: string | null) => {
      const code = normalizeStripeConnectStatus(codeRaw);
      setStripeStatus(code);
      setStripeStatusLabel(label?.trim() || stripeConnectStatusLabel(code));
      setStripeStatusMessage(message?.trim() || stripeConnectUserMessage(code));
    },
    [],
  );

  const fetchWallet = useCallback(
    async (aliveRef?: { alive: boolean }) => {
      try {
        setLoading(true);

        const { data: sessionData, error: sErr } = await supabase.auth.getSession();
        if (sErr) console.log("getSession error:", sErr);

        const session = sessionData?.session;

        if (!session) {
          if (aliveRef && !aliveRef.alive) return;
          setDriverId(null);
          setStripeAccountId(null);
          applyStripeStatus("setup_required");
          setAvailableCents(0);
          setAwaitingTransferCents(0);
          setSettlingCents(0);
          setConfirmedEarningsCents(0);
          setConnectAvailableCents(0);
          setPendingCents(0);
          setLedgerBalanceCents(0);
          setInstantEligible(false);
          setCanCashout(false);
          setCashoutBlockReason(null);
          setCashoutBlockedToday(false);
          setLastCashoutAt(null);
          setPayoutMethods([]);
          setLedgerHistory([]);
          setPayoutTransactions([]);
          return;
        }

        const uid = session.user.id;
        if (aliveRef && !aliveRef.alive) return;
        setDriverId(uid);

        const { data: connectData, error: syncErr } = await supabase.functions.invoke(
          "check_connect_status",
          {
            body: { role: "driver" },
            headers: { Authorization: `Bearer ${session.access_token}` },
          },
        );
        if (syncErr) {
          logTechnicalError("driver.wallet.check_connect_status", syncErr);
        } else if (connectData && typeof connectData === "object") {
          const connect = connectData as Record<string, unknown>;
          if (aliveRef && !aliveRef.alive) return;
          if (connect.stripe_account_id != null) {
            setStripeAccountId(
              connect.stripe_account_id ? String(connect.stripe_account_id) : null,
            );
          }
          applyStripeStatus(connect.status, String(connect.status_label ?? ""), null);
        }

        const snapshot = await fetchDriverWalletSnapshot(session.access_token);
        if (aliveRef && !aliveRef.alive) return;

        const summary = snapshot.summary;
        const walletCurrency = summary.currency ?? "USD";

        setCurrency(walletCurrency);
        setAvailableCents(summary.available_cents ?? 0);
        setAwaitingTransferCents(summary.awaiting_transfer_cents ?? 0);
        setSettlingCents(
          summary.settling_cents ?? summary.pending_cents ?? 0,
        );
        setConfirmedEarningsCents(
          summary.confirmed_earnings_cents ??
            (summary.awaiting_transfer_cents ?? 0) +
              (summary.connect_available_cents ?? summary.available_cents ?? 0) +
              (summary.settling_cents ?? summary.pending_cents ?? 0),
        );
        setConnectAvailableCents(summary.connect_available_cents ?? 0);
        setPendingCents(summary.pending_cents ?? summary.settling_cents ?? 0);
        setLedgerBalanceCents(summary.balance_cents ?? 0);
        setInstantEligible(Boolean(summary.instant_payout_eligible));
        setMinimumPayoutCents(summary.minimum_payout_cents ?? 0);
        setStripeAccountId(summary.stripe_account_id ?? null);
        if (summary.stripe_status) {
          applyStripeStatus(
            summary.stripe_status,
            summary.stripe_status_label,
            summary.stripe_status_message,
          );
        }
        if (connectData && typeof connectData === "object") {
          const connect = connectData as Record<string, unknown>;
          if (connect.status) {
            applyStripeStatus(connect.status, String(connect.status_label ?? ""), null);
          }
        }
        setCanCashout(Boolean(summary.can_cashout));
        setCashoutBlockReason(summary.cashout_block_reason ?? null);
        setCashoutBlockedToday(Boolean(summary.cashout_blocked_today));
        setLastCashoutAt(summary.last_cashout_at ?? null);
        setPayoutMethods(snapshot.payoutMethods.methods ?? []);
        setLedgerHistory(snapshot.history.items ?? []);
        setPayoutTransactions(snapshot.payoutTransactions.items ?? []);
      } catch (e: any) {
        logTechnicalError("driver.wallet.fetchWallet", e);
        Alert.alert(
          t("common.errorTitle", "Error"),
          toUserFacingError(e, t("driver.wallet.loadError", "Unable to load wallet.")),
        );
      } finally {
        if (aliveRef && !aliveRef.alive) return;
        setLoading(false);
        setInitialLoad(false);
      }
    },
    [t, applyStripeStatus],
  );

  useFocusEffect(
    useCallback(() => {
      const aliveRef = { alive: true };
      void fetchWallet(aliveRef);

      return () => {
        aliveRef.alive = false;
      };
    }, [fetchWallet]),
  );

  const onPressActivateStripe = useCallback(async () => {
    if (loading) return;

    try {
      setLoading(true);
      await startStripeOnboarding("driver");
      await fetchWallet();
    } catch (e: any) {
      Alert.alert(
        t("driver.wallet.stripe.title", "Stripe"),
        toUserFacingError(
          e,
          t("driver.wallet.stripe.startError", "Unable to start Stripe onboarding."),
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [loading, fetchWallet, t]);

  const runCashout = useCallback(async () => {
    if (!driverId || cashoutInFlight) return;
    try {
      setCashoutInFlight(true);
      setLoading(true);
      setConfirmOpen(false);

      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (sessionErr || !accessToken) {
        Alert.alert(
          t("driver.wallet.cashout.title", "Cash out"),
          t("driver.wallet.cashout.authError", "Please sign in again."),
        );
        return;
      }

      const payload = await requestWalletCashOut(accessToken, {
        accountType: "driver",
        currency,
        source: "mobile_wallet_cashout",
      });

      if (!payload?.ok || payload?.error) {
        logTechnicalError("driver.wallet.driver-cashout", payload);
        Alert.alert(
          t("driver.wallet.cashout.title", "Cash out"),
          toUserFacingError(
            {
              code: payload.error,
              message: payload.message ?? payload.error,
            },
            t("driver.wallet.cashout.requestError", "Unable to request cash out."),
          ),
        );
        return;
      }

      const paidCents =
        typeof payload?.payout_amount_cents === "number"
          ? payload.payout_amount_cents
          : availableCents;

      setSuccessCents(paidCents);
      await fetchWallet();
    } catch (e: any) {
      logTechnicalError("driver.wallet.cashout", e);
      Alert.alert(
        t("driver.wallet.cashout.title", "Cash out"),
        toUserFacingError(
          e,
          t("driver.wallet.cashout.runtimeError", "Error during cash out."),
        ),
      );
    } finally {
      setCashoutInFlight(false);
      setLoading(false);
    }
  }, [
    driverId,
    cashoutInFlight,
    currency,
    availableCents,
    fetchWallet,
    t,
  ]);

  const onPressCashout = useCallback(async () => {
    if (!driverId || loading || cashoutInFlight) return;

    if (!canCashout) {
      Alert.alert(
        t("driver.wallet.cashoutUnavailable.title", "Cash out unavailable"),
        cashoutReason ||
          stripeStatusMessage ||
          t("driver.wallet.cashoutUnavailable.body", "Cash out unavailable."),
      );
      return;
    }

    setConfirmOpen(true);
  }, [
    driverId,
    loading,
    cashoutInFlight,
    canCashout,
    cashoutReason,
    stripeStatusMessage,
    t,
  ]);

  const statusReady = isStripeConnectReady(stripeStatus);
  const fundedSetup = !statusReady && availableCents > 0;
  const statusPillStyle = statusReady
    ? styles.statusReady
    : stripeStatus === "restricted" || stripeStatus === "disabled"
      ? styles.statusDanger
      : styles.statusWarning;
  const statusDotColor = statusReady
    ? MMD_TAXI_GREEN
    : stripeStatus === "restricted" || stripeStatus === "disabled"
      ? RED
      : AMBER;

  const availableMethods = payoutMethods.filter((method) => method.available);

  if (initialLoad && loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
        <ScreenHeader
          title={t("driver.wallet.header.title", "Wallet")}
          fallbackRoute="DriverTabs"
          variant="mmd"
        />
        <DriverBrandLoadingState title={t("common.loading", "Loading…")} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <View style={styles.root}>
        <ScreenHeader
          title={t("driver.wallet.header.title", "Wallet")}
          fallbackRoute="DriverTabs"
          variant="mmd"
          rightSlot={
            <TouchableOpacity
              onPress={() => fetchWallet()}
              style={[styles.refreshButton, loading && { opacity: 0.65 }]}
              disabled={loading}
              activeOpacity={0.85}
            >
              <Text style={styles.refreshText}>
                {loading
                  ? t("shared.common.loadingEllipsis", "…")
                  : t("shared.common.refresh", "Refresh")}
              </Text>
            </TouchableOpacity>
          }
        />

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={[styles.heroCard, fundedSetup && styles.heroCardSetup]}>
            {fundedSetup ? (
              <View style={styles.heroTopRow}>
                <View style={styles.earningsInline}>
                  <Text style={styles.eyebrowAmber}>
                    💰 {t("driver.wallet.title", "Earnings")}
                  </Text>
                  <View style={[styles.statusPill, styles.statusWarning, { marginLeft: 8 }]}>
                    <View style={[styles.statusDot, { backgroundColor: AMBER }]} />
                    <Text style={styles.statusText}>{stripeStatusLabel}</Text>
                  </View>
                </View>
              </View>
            ) : (
              <View style={styles.heroTopRow}>
                <View>
                  <Text style={styles.eyebrow}>
                    💰 {t("driver.wallet.title", "Earnings")}
                  </Text>
                  <Text style={styles.heroLabel}>
                    {t("driver.wallet.available.title", "Available to cash out")}
                  </Text>
                </View>
                <View style={[styles.statusPill, statusPillStyle]}>
                  <View style={[styles.statusDot, { backgroundColor: statusDotColor }]} />
                  <Text style={styles.statusText}>{stripeStatusLabel}</Text>
                </View>
              </View>
            )}

            {loading ? (
              <View style={styles.loadingBlock} accessibilityRole="progressbar">
                <ActivityIndicator color={LILAC} />
                <Text style={styles.loadingText}>{t("common.loading", "Loading…")}</Text>
              </View>
            ) : (
              <>
                <Text style={[styles.availableAmount, fundedSetup && { fontSize: 32 }]}>
                  {fmtMoney(availableCents)}
                </Text>
                <Text style={styles.rulesText}>
                  {instantEligible
                    ? t(
                        "driver.wallet.available.instantHint",
                        "Retirable via Instant Payout when eligible (Stripe Connect)",
                      )
                    : t(
                        "driver.wallet.available.connectHint",
                        "Available to cash out from your Stripe Connect balance",
                      )}
                </Text>
                {confirmedEarningsCents > 0 ? (
                  <Text style={styles.reasonTextMuted}>
                    {t(
                      "driver.wallet.confirmed.hint",
                      "Confirmed earnings: {{amount}}",
                      { amount: fmtMoney(confirmedEarningsCents) },
                    )}
                  </Text>
                ) : null}
                {connectAvailableCents > 0 ? (
                  <Text style={styles.reasonTextMuted}>
                    {t(
                      "driver.wallet.bankAvailable.hint",
                      "Stripe available now: {{amount}} — Instant Cash Out if eligible, else Sunday 4:00 AM ET bank payout. Not pending/settling.",
                      { amount: fmtMoney(connectAvailableCents) },
                    )}
                  </Text>
                ) : null}
                <Text style={styles.reasonTextMuted}>
                  {t(
                    "driver.wallet.moneyStages.hint",
                    "Stages: earned → transferred to Connect → Stripe pending → available → Instant Cash Out or Sunday 4:00 AM ET bank payout. Pending is never available or paid out.",
                  )}
                </Text>
                {settlingCents > 0 || awaitingTransferCents > 0 ? (
                  <Text style={styles.reasonTextMuted}>
                    {t(
                      "driver.wallet.breakdown.pending",
                      "Pending Stripe settlement: {{settling}} · Awaiting platform transfer: {{awaiting}}",
                      {
                        settling: fmtMoney(settlingCents),
                        awaiting: fmtMoney(awaitingTransferCents),
                      },
                    )}
                  </Text>
                ) : null}

                {!canCashout && cashoutReason ? (
                  <TouchableOpacity
                    onPress={onPressActivateStripe}
                    activeOpacity={0.85}
                    disabled={statusReady}
                  >
                    <Text
                      style={[
                        styles.reasonText,
                        fundedSetup && styles.reasonLink,
                        statusReady && { color: MMD_MUTED },
                      ]}
                    >
                      {cashoutReason}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  onPress={onPressCashout}
                  disabled={loading || cashoutInFlight || !canCashout}
                  style={[
                    styles.cashoutButton,
                    canCashout && !cashoutInFlight
                      ? styles.cashoutReady
                      : styles.cashoutDisabled,
                  ]}
                  activeOpacity={0.88}
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: loading || cashoutInFlight || !canCashout,
                  }}
                  accessibilityLabel={t("driver.wallet.available.cashoutButton", "Cash out")}
                >
                  <Text style={[styles.cashoutText, !canCashout && { color: MMD_MUTED }]}>
                    {cashoutInFlight
                      ? t("shared.common.loadingEllipsis", "…")
                      : t("driver.wallet.available.cashoutButton", "Cash out")}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {!loading ? (
              <View style={styles.setupCard} testID="driver-bank-payout-card">
                <View style={[styles.cardIconBox, statusReady ? styles.cardIconLilac : undefined]}>
                  <Text style={styles.cardEmoji}>{statusReady ? "🏦" : "💳"}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.setupTitle}>
                    {t("driver.wallet.stripe.manageTitle", "Bank & payout method")}
                  </Text>
                  <Text style={styles.setupSub}>
                    {statusReady
                      ? t(
                          "driver.wallet.stripe.manageDesc",
                          "Add, update or replace your bank account in Stripe Express.",
                        )
                      : stripeAccountId
                        ? t(
                            "driver.wallet.stripe.continueDesc",
                            "Finish Stripe verification to unlock bank payouts.",
                          )
                        : t(
                            "driver.wallet.stripe.connectBankDesc",
                            "Connect your bank account in Stripe Express. MMD never collects routing or account numbers.",
                          )}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={onPressActivateStripe}
                  disabled={loading}
                  style={[
                    statusReady
                      ? styles.manageBtn
                      : stripeAccountId
                        ? styles.continueBtn
                        : styles.enableBtn,
                    loading && { opacity: 0.6 },
                  ]}
                  activeOpacity={0.86}
                  accessibilityLabel={
                    statusReady
                      ? t("driver.wallet.stripe.manageButton", "Manage")
                      : t("driver.wallet.stripe.connectBankButton", "Connect your bank account")
                  }
                >
                  <Text
                    style={
                      statusReady
                        ? styles.manageBtnText
                        : stripeAccountId
                          ? styles.continueBtnText
                          : styles.enableBtnText
                    }
                  >
                    {statusReady
                      ? t("driver.wallet.stripe.manageButton", "Manage")
                      : stripeAccountId
                        ? t("driver.wallet.stripe.continueButton", "Continue")
                        : t(
                            "driver.wallet.stripe.connectBankButton",
                            "Connect your bank account",
                          )}
                  </Text>
                </TouchableOpacity>
              </View>
          ) : null}

          {!loading ? (
            <>
              <View style={styles.cardsRow}>
                <MetricCard
                  label={t("driver.wallet.earnings.title", "Earnings")}
                  amount={fmtMoney(confirmedEarningsCents)}
                  sub={t(
                    "driver.wallet.earnings.desc",
                    "Confirmed completed work",
                  )}
                />
                <MetricCard
                  label={t("driver.wallet.available.title", "Available to cash out")}
                  amount={fmtMoney(availableCents)}
                  sub={
                    instantEligible
                      ? t(
                          "driver.wallet.available.instant",
                          "Instant-eligible to your bank or debit card",
                        )
                      : t(
                          "driver.wallet.available.waitSunday",
                          "Add an Instant-eligible bank or debit card, or wait for Sunday bank payout",
                        )
                  }
                />
              </View>

              {awaitingTransferCents > 0 || settlingCents > 0 ? (
                <Text style={styles.infoSub}>
                  {t(
                    "driver.wallet.processingHint",
                    "Some earnings are still processing and will become available when Stripe allows payout.",
                  )}
                </Text>
              ) : null}

              <View style={styles.infoCard}>
                <Text style={styles.infoTitle}>
                  {t("driver.wallet.nextAuto.title", "Next automatic payout")}
                </Text>
                <Text style={styles.infoSub}>
                  {t(
                    "driver.wallet.nextAuto.desc",
                    "MMD sends remaining Stripe Connect available funds to your bank every Sunday at 04:00 AM (America/New_York). Instant Cash Out is available mid-week when Stripe Instant eligibility allows. There is no afternoon catch-up payout. This is MMD’s schedule, not Stripe’s default daily payout.",
                  )}
                </Text>
              </View>

              {!fundedSetup ? (
                <View style={styles.cardsRow}>
                  <MetricCard
                    label={t("driver.wallet.lastCashout.title", "Last cash out")}
                    amount={fmtMoney(payoutBuckets.processingCents + payoutBuckets.completedCents)}
                    sub={
                      payoutBuckets.processingCount > 0
                        ? t("driver.wallet.lastCashout.processing", "Processing")
                        : payoutBuckets.failedCents > 0
                          ? t("driver.wallet.lastCashout.failed", "Failed: {{amount}}", {
                              amount: fmtMoney(payoutBuckets.failedCents),
                            })
                          : t("driver.wallet.lastCashout.paid", "Paid / completed: {{amount}}", {
                              amount: fmtMoney(payoutBuckets.completedCents),
                            })
                    }
                  />
                  <MetricCard
                    label={t("driver.wallet.completed.title", "Bank payouts")}
                    amount={fmtMoney(payoutBuckets.completedCents)}
                    sub={t("driver.wallet.failed.short", "Failed: {{amount}}", {
                      amount: fmtMoney(payoutBuckets.failedCents),
                    })}
                  />
                </View>
              ) : null}

              {availableMethods.length > 0 ? (
                <View style={styles.infoCard}>
                  <Text style={styles.infoTitle}>
                    {t("driver.wallet.payoutMethods.title", "Payout methods")}
                  </Text>
                  {availableMethods.map((method) => (
                    <Text key={method.method_code} style={styles.infoSub}>
                      {method.display_name}
                      {method.auto_payout_enabled
                        ? ` • ${t("driver.wallet.payoutMethods.auto", "Automatic")}`
                        : ` • ${t("driver.wallet.payoutMethods.manual", "Manual")}`}
                    </Text>
                  ))}
                </View>
              ) : null}

              {(cashoutBlockedToday && lastCashoutAt) || payoutBuckets.lastPayout ? (
                <View style={styles.infoCard}>
                  <Text style={styles.infoTitle}>
                    {t("driver.wallet.available.lastCashout", "Last cash out")}
                  </Text>
                  <Text style={styles.infoSub}>
                    {lastCashoutAt
                      ? formatDateTime(lastCashoutAt, localeForDates)
                      : payoutBuckets.lastPayout
                        ? `${fmtMoney(payoutBuckets.lastPayout.amount_cents)} • ${formatDateTime(
                            payoutBuckets.lastPayout.created_at,
                            localeForDates,
                          )}`
                        : t("common.dash", "—")}
                  </Text>
                </View>
              ) : null}

              {payoutTransactions.length > 0 ? (
                <View style={styles.listCard}>
                  <Text style={styles.listTitle}>
                    {t("driver.wallet.payouts.title", "Recent payouts")}
                  </Text>
                  {payoutTransactions.slice(0, 8).map((item) => {
                    const tone = financialStatusColor(item.status);
                    const isPaid = tone === MMD_TAXI_GREEN;
                    const isPending = tone === AMBER;
                    return (
                      <View key={item.id} style={styles.payoutRow}>
                        <Text style={styles.payoutAmount}>{fmtMoney(item.amount_cents)}</Text>
                        <Text style={styles.payoutMeta} numberOfLines={2}>
                          {formatWalletField(item.provider, "Stripe")} •{" "}
                          {formatDateTime(item.created_at, localeForDates)}
                          {formatWalletField(item.failure_reason, "")
                            ? ` • ${formatWalletField(item.failure_reason)}`
                            : ""}
                        </Text>
                        <View
                          style={[
                            styles.payoutBadge,
                            isPaid && styles.payoutBadgePaid,
                            isPending && styles.payoutBadgePending,
                          ]}
                        >
                          <Text
                            style={[
                              styles.payoutBadgeText,
                              { color: payoutStatusColor(formatWalletField(item.status, "processing")) },
                            ]}
                          >
                            {payoutStatusLabel(item.status)}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <View style={styles.emptyPayouts}>
                  <Text style={styles.emptyTitle}>
                    {fundedSetup
                      ? `📭 ${t("driver.wallet.payouts.emptyTitle", "No payouts yet")}`
                      : t("driver.wallet.payouts.emptyTitle", "No payouts yet")}
                  </Text>
                  <Text style={styles.emptyBody}>
                    {t(
                      "driver.wallet.payouts.emptyBody",
                      "Completed cash outs will appear here.",
                    )}
                  </Text>
                </View>
              )}

              {ledgerHistory.length > 0 ? (
                <View style={styles.listCard}>
                  <View style={styles.sectionRow}>
                    <Text style={styles.listTitle}>
                      {t("driver.wallet.history.title", "Wallet history")}
                    </Text>
                    <TouchableOpacity
                      onPress={() =>
                        navigation.navigate("DriverTabs", {
                          screen: "DriverRevenueTab",
                        })
                      }
                    >
                      <Text style={styles.earningsLink}>
                        {t("driver.wallet.openEarnings", "Earnings")}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.filterBar}>
                    {(["all", "earnings", "payouts"] as const).map((key) => (
                      <TouchableOpacity
                        key={key}
                        style={[styles.filterTab, txFilter === key && styles.filterTabOn]}
                        onPress={() => setTxFilter(key)}
                      >
                        <Text style={[styles.filterText, txFilter === key && styles.filterTextOn]}>
                          {key === "all"
                            ? t("driver.wallet.filterAll", "All")
                            : key === "earnings"
                              ? t("driver.wallet.filterEarnings", "Earnings")
                              : t("driver.wallet.filterPayouts", "Payouts")}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {(txFilter !== "payouts" ? ledgerHistory : [])
                    .filter((item) =>
                      txFilter === "earnings" ? item.direction === "credit" : true,
                    )
                    .slice(0, 8)
                    .map((item) => {
                      const linked = resolveWalletLinkedJob(item);
                      return (
                    <TouchableOpacity
                      key={item.id}
                      style={styles.historyRow}
                      disabled={!linked}
                      onPress={() => {
                        if (!linked) return;
                        if (linked.kind === "taxi_ride") {
                          navigation.navigate("DriverOrderDetails", {
                            orderId: linked.id,
                            sourceTable: "taxi_rides",
                          });
                          return;
                        }
                        if (linked.kind === "order") {
                          navigation.navigate("DriverOrderDetails", {
                            orderId: linked.id,
                            sourceTable: "orders",
                          });
                          return;
                        }
                        navigation.navigate("DriverOrderDetails", {
                          orderId: linked.id,
                          sourceTable: "delivery_requests",
                        });
                      }}
                    >
                      <Text style={styles.historyTitle} numberOfLines={1}>
                        {item.description ?? item.reference_type}
                      </Text>
                      <Text
                        style={[
                          styles.historyAmount,
                          {
                            color:
                              item.direction === "credit" ? MMD_TAXI_GREEN : "#EF4444",
                          },
                        ]}
                      >
                        {`${item.direction === "credit" ? "+" : "−"}${fmtMoney(item.amount_cents)}`}
                      </Text>
                      <Text style={styles.historyMeta}>
                        {formatDateTime(item.created_at, localeForDates)}
                      </Text>
                    </TouchableOpacity>
                      );
                    })}
                </View>
              ) : null}

              <BrandFooter stacked={fundedSetup} />
            </>
          ) : null}
        </ScrollView>
        {confirmOpen ? (
          <View style={styles.overlay}>
            <View style={styles.overlayCard}>
              <Text style={styles.overlayKicker}>
                {t("driver.wallet.confirm.kicker", "CONFIRM CASHOUT AMOUNT")}
              </Text>
              <Text style={styles.overlayMeta}>
                {t("driver.wallet.confirm.balance", "Current available: {{amount}}", {
                  amount: fmtMoney(availableCents),
                })}
              </Text>
              <Text style={styles.overlayAmount}>{fmtMoney(availableCents)}</Text>
              <Text style={styles.overlayHint}>
                {t(
                  "driver.wallet.confirm.hint",
                  "Instant cash out sends the full eligible available balance. Amount is not client-controlled.",
                )}
              </Text>
              {availableMethods[0]?.display_name ? (
                <View style={styles.destCard}>
                  <Text style={styles.destKicker}>
                    {t("driver.wallet.confirm.destination", "DESTINATION")}
                  </Text>
                  <Text style={styles.destName}>{availableMethods[0].display_name}</Text>
                </View>
              ) : null}
              <TouchableOpacity
                style={[styles.cashoutButton, styles.cashoutReady]}
                onPress={() => void runCashout()}
                disabled={cashoutInFlight}
              >
                <Text style={styles.cashoutText}>
                  {t("driver.wallet.confirm.cta", "Confirm cash out")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setConfirmOpen(false)}
              >
                <Text style={styles.cancelText}>{t("common.cancel", "Cancel")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
        {successCents != null ? (
          <View style={styles.overlay}>
            <View style={styles.overlayCard}>
              <View style={styles.successCircle}>
                <Text style={styles.successCheck}>✓</Text>
              </View>
              <Text style={styles.successTitle}>
                {t("driver.wallet.success.title", "Cash out successful!")}
              </Text>
              <Text style={styles.overlayAmount}>{fmtMoney(successCents)}</Text>
              <TouchableOpacity
                style={[styles.cashoutButton, styles.cashoutReady]}
                onPress={() => setSuccessCents(null)}
              >
                <Text style={styles.cashoutText}>{t("common.done", "Done")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  root: { flex: 1, backgroundColor: MMD_BLUE },
  refreshButton: {
    minWidth: 86,
    height: 42,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  refreshText: {
    color: MMD_TEXT,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 12,
  },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 32, gap: 14 },
  heroCard: {
    borderRadius: 24,
    padding: 20,
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
  },
  heroCardSetup: {
    borderColor: "rgba(255,255,255,0.1)",
    padding: 16,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  earningsInline: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  eyebrow: {
    color: LILAC,
    fontSize: 13,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  eyebrowAmber: {
    color: AMBER,
    fontSize: 14,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  heroLabel: {
    color: MMD_MUTED,
    fontSize: 13,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    marginTop: 4,
  },
  statusPill: {
    minHeight: 32,
    borderRadius: 999,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    paddingVertical: 4,
  },
  statusReady: {
    backgroundColor: "rgba(34,197,94,0.1)",
    borderColor: "rgba(34,197,94,0.24)",
  },
  statusWarning: {
    backgroundColor: "rgba(245,158,11,0.1)",
    borderColor: "rgba(245,158,11,0.24)",
  },
  statusDanger: {
    backgroundColor: "rgba(239,68,68,0.12)",
    borderColor: "rgba(239,68,68,0.35)",
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 7 },
  statusText: {
    color: MMD_TEXT,
    fontSize: 11,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  loadingBlock: {
    marginTop: 18,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 20,
  },
  loadingText: {
    color: MMD_TEXT,
    fontSize: 20,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  availableAmount: {
    color: MMD_TEXT,
    fontSize: 42,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    marginTop: 10,
    letterSpacing: -1,
  },
  rulesText: {
    color: "rgba(255,255,255,0.85)",
    marginTop: 8,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 12,
    lineHeight: 19,
  },
  reasonText: {
    color: AMBER,
    marginTop: 10,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    lineHeight: 19,
    fontSize: 13,
  },
  reasonLink: { textDecorationLine: "underline", fontSize: 12 },
  reasonTextMuted: {
    color: MMD_MUTED,
    marginTop: 8,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    lineHeight: 18,
  },
  cashoutButton: {
    marginTop: 16,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  cashoutReady: {
    backgroundColor: MMD_TAXI_GREEN,
    borderColor: MMD_TAXI_GREEN,
  },
  cashoutDisabled: {
    backgroundColor: "rgba(0,51,204,0.55)",
    borderColor: "rgba(255,255,255,0.1)",
    opacity: 0.65,
    height: 44,
    borderRadius: 12,
  },
  cashoutText: {
    color: MMD_TEXT,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 15,
  },
  setupCard: {
    borderRadius: 20,
    padding: 14,
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
    flexDirection: "row",
    alignItems: "center",
  },
  cardIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  cardIconLilac: {
    width: 46,
    height: 46,
    borderRadius: 17,
    backgroundColor: "rgba(167,139,250,0.14)",
  },
  cardEmoji: { fontSize: 18 },
  setupTitle: {
    color: MMD_TEXT,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 15,
  },
  setupSub: {
    color: "rgba(255,255,255,0.7)",
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 12,
    marginTop: 4,
    lineHeight: 17,
  },
  enableBtn: {
    backgroundColor: MMD_TAXI_GREEN,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginLeft: 10,
  },
  enableBtnText: {
    color: MMD_BLUE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 13,
  },
  continueBtn: {
    backgroundColor: LILAC,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
  },
  continueBtnText: {
    color: MMD_BLUE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 13,
  },
  manageBtn: {
    height: 40,
    borderRadius: 14,
    paddingHorizontal: 13,
    backgroundColor: "rgba(167,139,250,0.16)",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.38)",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
    minWidth: 80,
  },
  manageBtnText: {
    color: LILAC,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 12,
  },
  cardsRow: { flexDirection: "row", gap: 12 },
  metricCard: {
    flex: 1,
    minHeight: 132,
    borderRadius: 24,
    padding: 15,
    backgroundColor: MMD_ACTION_NAVY,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 8,
  },
  metricLabel: {
    color: MMD_MUTED,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 12,
  },
  metricAmount: {
    color: MMD_TEXT,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 22,
  },
  metricSub: {
    color: SLATE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 11,
    lineHeight: 15,
  },
  infoCard: {
    borderRadius: 14,
    padding: 14,
    backgroundColor: MMD_ACTION_NAVY,
    borderWidth: 1,
    borderColor: BORDER,
  },
  infoTitle: {
    color: MMD_MUTED,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 12,
  },
  infoSub: {
    color: MMD_TEXT,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    marginTop: 5,
  },
  listCard: {
    borderRadius: 20,
    padding: 14,
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
    gap: 12,
  },
  listTitle: {
    color: MMD_TEXT,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
  },
  payoutRow: {
    backgroundColor: MMD_BLUE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  payoutAmount: {
    flex: 1,
    color: MMD_TEXT,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
  },
  payoutMeta: {
    flex: 1,
    color: MMD_MUTED,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 12,
  },
  payoutBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: BORDER,
  },
  payoutBadgePaid: {
    backgroundColor: "rgba(34,197,94,0.1)",
    borderColor: "rgba(34,197,94,0.24)",
  },
  payoutBadgePending: {
    backgroundColor: "rgba(245,158,11,0.1)",
    borderColor: "rgba(245,158,11,0.24)",
  },
  payoutBadgeText: {
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 11,
    textTransform: "lowercase",
  },
  historyRow: {
    backgroundColor: MMD_BLUE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  historyTitle: {
    flex: 1,
    color: MMD_TEXT,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
  },
  historyAmount: {
    flex: 1,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
  },
  historyMeta: {
    flex: 1,
    color: MMD_MUTED,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 12,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 8,
  },
  footerStacked: {
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
  },
  footerLogo: { width: 44, height: 44, borderRadius: 10 },
  footerBrand: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
  },
  emptyPayouts: {
    borderRadius: 14,
    padding: 18,
    minHeight: 80,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    gap: 6,
  },
  emptyTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
  },
  emptyBody: {
    color: "rgba(255,255,255,0.7)",
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 13,
    lineHeight: 20,
  },
  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  earningsLink: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 13,
  },
  filterBar: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 10,
    padding: 3,
  },
  filterTab: {
    flex: 1,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  filterTabOn: { backgroundColor: "rgba(255,255,255,0.14)" },
  filterText: {
    color: "rgba(255,255,255,0.65)",
    fontFamily: MMD_FONT.semibold,
    fontSize: 12,
  },
  filterTextOn: { color: MMD_WHITE, fontFamily: MMD_FONT.bold },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,20,80,0.72)",
    justifyContent: "center",
    padding: 16,
  },
  overlayCard: {
    backgroundColor: MMD_GLASS,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
    padding: 24,
    gap: 12,
  },
  overlayKicker: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.extrabold,
    fontSize: 12,
    letterSpacing: 0.6,
  },
  overlayMeta: {
    color: "rgba(255,255,255,0.8)",
    fontFamily: MMD_FONT.regular,
  },
  overlayAmount: {
    color: MMD_WHITE,
    fontSize: 40,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    textAlign: "center",
  },
  overlayHint: {
    color: MMD_MUTED,
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  destCard: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 14,
    padding: 12,
  },
  destKicker: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.bold,
    fontSize: 11,
  },
  destName: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    marginTop: 4,
  },
  cancelBtn: {
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
  },
  cancelText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  successCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: MMD_TAXI_GREEN,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  successCheck: {
    color: MMD_WHITE,
    fontSize: 28,
    fontFamily: MMD_FONT.extrabold,
  },
  successTitle: {
    color: MMD_WHITE,
    fontSize: 22,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    textAlign: "center",
  },
});
