import React, { useCallback, useMemo, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { startStripeOnboarding } from "../utils/stripe";

const BG = "#020617";
const CARD = "rgba(15,23,42,0.86)";
const CARD_SOFT = "rgba(2,6,23,0.72)";
const BORDER = "rgba(148,163,184,0.14)";
const PURPLE = "#A78BFA";
const PURPLE_DARK = "#8B5CF6";
const GREEN = "#22C55E";
const RED = "#FCA5A5";
const TEXT = "#F8FAFC";
const MUTED = "#94A3B8";
const BLUE = "#93C5FD";

function toNumber(v: any) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(v: any) {
  const n = toNumber(v);
  return `${n.toFixed(2)} $ US`;
}

function isSameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

async function getFunctionErrorMessage(error: any) {
  try {
    const context = error?.context;

    if (context && typeof context.json === "function") {
      const parsed = await context.json();
      if (typeof parsed?.error === "string") return parsed.error;
      if (typeof parsed?.message === "string") return parsed.message;
      return JSON.stringify(parsed);
    }

    if (context && typeof context.text === "function") {
      const text = await context.text();
      if (text?.trim()) return text;
    }

    if (typeof error?.context?.body === "string") {
      return error.context.body;
    }

    if (typeof error?.message === "string") {
      return error.message;
    }
  } catch {}

  return "Unable to request cash out.";
}

export function DriverWalletScreen() {
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation();

  const MIN_CASHOUT = 20;

  const [loading, setLoading] = useState(false);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [stripeAccountId, setStripeAccountId] = useState<string | null>(null);
  const [stripeOnboarded, setStripeOnboarded] = useState<boolean>(false);
  const [availableAmount, setAvailableAmount] = useState<number>(0);
  const [pendingAmount, setPendingAmount] = useState<number>(0);
  const [cashoutBlockedToday, setCashoutBlockedToday] = useState<boolean>(false);
  const [lastCashoutAt, setLastCashoutAt] = useState<string | null>(null);

  const localeForDates = useMemo(() => {
    const lng = String(i18n.language || "en").toLowerCase();
    if (lng.startsWith("fr")) return "fr-FR";
    if (lng.startsWith("es")) return "es-ES";
    if (lng.startsWith("ar")) return "ar";
    if (lng.startsWith("zh")) return "zh-CN";
    if (lng.startsWith("ff")) return "fr-FR";
    return "en-US";
  }, [i18n.language]);

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
          setStripeOnboarded(false);
          setAvailableAmount(0);
          setPendingAmount(0);
          setCashoutBlockedToday(false);
          setLastCashoutAt(null);
          return;
        }

        const uid = session.user.id;

        if (aliveRef && !aliveRef.alive) return;
        setDriverId(uid);

        const { error: syncErr } = await supabase.functions.invoke("check_connect_status", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });

        if (syncErr) console.log("check_connect_status error:", syncErr);

        const { data: dp, error: dpErr } = await supabase
          .from("driver_profiles")
          .select("stripe_account_id, stripe_onboarded")
          .eq("user_id", uid)
          .maybeSingle();

        if (aliveRef && !aliveRef.alive) return;

        if (dpErr) {
          console.log("driver_profiles stripe read error:", dpErr);
          setStripeAccountId(null);
          setStripeOnboarded(false);
        } else {
          setStripeAccountId((dp as any)?.stripe_account_id ?? null);
          setStripeOnboarded(Boolean((dp as any)?.stripe_onboarded));
        }

        const { data: deliveredOrders, error: ordersErr } = await supabase
          .from("orders")
          .select("driver_delivery_payout, tip_cents, driver_payout_id")
          .eq("driver_id", uid)
          .eq("status", "delivered")
          .eq("driver_paid_out", false)
          .is("driver_payout_id", null);

        if (ordersErr) throw ordersErr;

        const { data: deliveredRequests, error: requestsErr } = await supabase
          .from("delivery_requests")
          .select("driver_delivery_payout, driver_payout_id")
          .eq("driver_id", uid)
          .eq("status", "delivered")
          .or("driver_paid_out.eq.false,driver_paid_out.is.null")
          .is("driver_payout_id", null);

        if (requestsErr) throw requestsErr;

        const ordersAvailable = (deliveredOrders ?? []).reduce((sum, o: any) => {
          // Production privacy rule:
          // Wallet balance must use only driver_delivery_payout + tips.
          // Never fall back to total or delivery_fee because those are customer-facing amounts.
          const base = toNumber(o?.driver_delivery_payout);
          const tipCents = toNumber(o?.tip_cents ?? 0);
          const tip = Math.max(0, tipCents) / 100;
          return sum + base + (Number.isFinite(tip) ? tip : 0);
        }, 0);

        const deliveryRequestsAvailable = (deliveredRequests ?? []).reduce((sum, r: any) => {
          // delivery_requests do not have tips here; only the exact driver payout is counted.
          return sum + toNumber(r?.driver_delivery_payout);
        }, 0);

        const available = ordersAvailable + deliveryRequestsAvailable;

        if (aliveRef && !aliveRef.alive) return;
        setAvailableAmount(Math.floor(available * 100) / 100);

        const { data: pendPayouts, error: pendErr } = await supabase
          .from("driver_payouts")
          .select("amount")
          .eq("driver_id", uid)
          .in("status", ["scheduled", "processing"]);

        if (aliveRef && !aliveRef.alive) return;

        if (pendErr) {
          console.log("driver_payouts pending fetch error:", pendErr);
          setPendingAmount(0);
        } else {
          const pending = (pendPayouts ?? []).reduce((sum, r: any) => sum + toNumber(r?.amount), 0);
          setPendingAmount(Math.floor(pending * 100) / 100);
        }

        const { data: lastPayoutRows, error: lpErr } = await supabase
          .from("driver_payouts")
          .select("created_at, status")
          .eq("driver_id", uid)
          .in("status", ["scheduled", "processing", "paid"])
          .order("created_at", { ascending: false })
          .limit(1);

        if (aliveRef && !aliveRef.alive) return;

        if (lpErr) {
          console.log("driver_payouts last check error:", lpErr);
          setCashoutBlockedToday(false);
          setLastCashoutAt(null);
        } else {
          const row = lastPayoutRows?.[0] ?? null;
          const createdAt = row?.created_at ? new Date(row.created_at) : null;

          setLastCashoutAt(row?.created_at ?? null);
          setCashoutBlockedToday(Boolean(createdAt && isSameLocalDay(createdAt, new Date())));
        }
      } catch (e: any) {
        console.log("fetchWallet error:", e);
        Alert.alert(t("common.errorTitle", "Error"), e?.message ?? t("driver.wallet.loadError", "Unable to load wallet."));
      } finally {
        if (aliveRef && !aliveRef.alive) return;
        setLoading(false);
      }
    },
    [t]
  );

  useFocusEffect(
    useCallback(() => {
      const aliveRef = { alive: true };
      void fetchWallet(aliveRef);

      return () => {
        aliveRef.alive = false;
      };
    }, [fetchWallet])
  );

  const canCashout = useMemo(() => {
    if (!stripeAccountId) return false;
    if (!stripeOnboarded) return false;
    if (cashoutBlockedToday) return false;
    if (availableAmount < MIN_CASHOUT) return false;
    return true;
  }, [stripeAccountId, stripeOnboarded, cashoutBlockedToday, availableAmount]);

  const cashoutReason = useMemo(() => {
    if (!stripeAccountId || !stripeOnboarded) {
      return t("driver.wallet.cashoutReason.needStripe", "Enable Stripe payouts to cash out.");
    }

    if (cashoutBlockedToday) {
      return t("driver.wallet.cashoutReason.alreadyToday", "You already requested a cash out today. Try again tomorrow.");
    }

    if (availableAmount < MIN_CASHOUT) {
      return t("driver.wallet.cashoutReason.min", "Minimum cash out: {{min}}.", {
        min: fmtMoney(MIN_CASHOUT),
      });
    }

    return "";
  }, [stripeAccountId, stripeOnboarded, cashoutBlockedToday, availableAmount, t]);

  const onPressActivateStripe = useCallback(async () => {
    if (loading) return;

    try {
      setLoading(true);
      await startStripeOnboarding("driver");
      await fetchWallet();
    } catch (e: any) {
      Alert.alert(
        t("driver.wallet.stripe.title", "Stripe"),
        e?.message ?? t("driver.wallet.stripe.startError", "Unable to start Stripe onboarding.")
      );
    } finally {
      setLoading(false);
    }
  }, [loading, fetchWallet, t]);

  const onPressCashout = useCallback(async () => {
    if (!driverId || loading) return;

    if (!canCashout) {
      Alert.alert(
        t("driver.wallet.cashoutUnavailable.title", "Cash out unavailable"),
        cashoutReason || t("driver.wallet.cashoutUnavailable.body", "Cash out unavailable.")
      );
      return;
    }

    const amountAll = Math.floor(availableAmount * 100) / 100;

    Alert.alert(
      t("driver.wallet.cashoutConfirm.title", "Instant cash out"),
      t(
        "driver.wallet.cashoutConfirm.body",
        "You will cash out your full available balance: {{amount}}.\n\nReminder: minimum {{min}} • 1 cash out / day.",
        { amount: fmtMoney(amountAll), min: fmtMoney(MIN_CASHOUT) }
      ),
      [
        { text: t("common.cancel", "Cancel"), style: "cancel" },
        {
          text: t("common.ok", "OK"),
          onPress: async () => {
            try {
              setLoading(true);

              const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
              const accessToken = sessionData?.session?.access_token;

              if (sessionErr || !accessToken) {
                Alert.alert(t("driver.wallet.cashout.title", "Cash out"), t("driver.wallet.cashout.authError", "Please sign in again."));
                return;
              }

              const { data, error } = await supabase.functions.invoke("pay-driver-now", {
                body: {
                  currency: "USD",
                  source: "mobile_wallet_cashout",
                },
                headers: { Authorization: `Bearer ${accessToken}` },
              });

              if (error) {
                const msg = await getFunctionErrorMessage(error);
                console.log("pay-driver-now error:", error);
                Alert.alert(
                  t("driver.wallet.cashout.title", "Cash out"),
                  msg || t("driver.wallet.cashout.requestError", "Unable to request cash out.")
                );
                return;
              }

              const payload = (data ?? {}) as any;
              const paidAmount = payload?.payout_amount ?? payload?.amount ?? payload?.total_amount ?? payload?.total ?? amountAll;

              Alert.alert(
                t("driver.wallet.cashoutRequested.title", "Cash out requested"),
                t("driver.wallet.cashoutRequested.body", "Cash out scheduled: {{amount}}.", { amount: fmtMoney(paidAmount) })
              );

              await fetchWallet();
            } catch (e: any) {
              Alert.alert(
                t("driver.wallet.cashout.title", "Cash out"),
                e?.message ?? t("driver.wallet.cashout.runtimeError", "Error during cash out.")
              );
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  }, [driverId, loading, canCashout, cashoutReason, availableAmount, fetchWallet, t]);

  const stripeStatusText = stripeOnboarded
    ? t("driver.wallet.status.ready", "Payouts ready")
    : t("driver.wallet.status.setupNeeded", "Setup needed");

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.root}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.roundButton} activeOpacity={0.85}>
            <Text style={styles.backIcon}>‹</Text>
          </TouchableOpacity>

          <Text style={styles.headerTitle}>{t("driver.wallet.header.title", "Wallet")}</Text>

          <TouchableOpacity onPress={() => fetchWallet()} style={[styles.refreshButton, loading && { opacity: 0.65 }]} disabled={loading} activeOpacity={0.85}>
            <Text style={styles.refreshText}>{loading ? t("shared.common.loadingEllipsis", "…") : t("shared.common.refresh", "Refresh")}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCard}>
            <View style={styles.heroTopRow}>
              <View>
                <Text style={styles.eyebrow}>{t("driver.wallet.title", "Earnings")}</Text>
                <Text style={styles.heroLabel}>{t("driver.wallet.available.title", "Available")}</Text>
              </View>

              <View style={[styles.statusPill, stripeOnboarded ? styles.statusReady : styles.statusWarning]}>
                <View style={[styles.statusDot, { backgroundColor: stripeOnboarded ? GREEN : "#F59E0B" }]} />
                <Text style={styles.statusText}>{stripeStatusText}</Text>
              </View>
            </View>

            {loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#fff" />
                <Text style={styles.loadingText}>{t("common.loading", "Loading…")}</Text>
              </View>
            ) : (
              <>
                <Text style={styles.availableAmount}>{fmtMoney(availableAmount)}</Text>
                <Text style={styles.rulesText}>
                  {t("driver.wallet.available.rules", "Minimum cash out: {{min}} • 1 cash out / day", { min: fmtMoney(MIN_CASHOUT) })}
                </Text>

                {!canCashout && cashoutReason ? <Text style={styles.reasonText}>{cashoutReason}</Text> : null}

                <TouchableOpacity
                  onPress={onPressCashout}
                  disabled={loading || !canCashout}
                  style={[styles.cashoutButton, canCashout ? styles.cashoutReady : styles.cashoutDisabled]}
                  activeOpacity={0.88}
                >
                  <Text style={[styles.cashoutText, !canCashout && { color: "#94A3B8" }]}>
                    {t("driver.wallet.available.cashoutButton", "Cash out")}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {!stripeOnboarded ? (
            <View style={styles.setupCard}>
              <View style={styles.cardIconBox}>
                <WalletIcon />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.setupTitle}>{t("driver.wallet.stripe.activateTitle", "Enable payouts")}</Text>
                <Text style={styles.setupSub}>{t("driver.wallet.stripe.activateDesc", "Set up Stripe to receive your payouts.")}</Text>
              </View>

              <TouchableOpacity onPress={onPressActivateStripe} disabled={loading} style={[styles.setupButton, loading && { opacity: 0.6 }]} activeOpacity={0.86}>
                <Text style={styles.setupButtonText}>{loading ? t("common.loading", "Loading…") : t("driver.wallet.stripe.activateButton", "Enable")}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.cardsRow}>
            <View style={styles.smallCard}>
              <Text style={styles.smallLabel}>{t("driver.wallet.pending.title", "Pending")}</Text>
              <Text style={styles.smallAmount}>{fmtMoney(pendingAmount)}</Text>
              <Text style={styles.smallSub}>{t("driver.wallet.pending.desc", "Cash outs in progress")}</Text>
            </View>

            <View style={styles.smallCard}>
              <Text style={styles.smallLabel}>{t("driver.wallet.cashout.limit", "Limit")}</Text>
              <Text style={styles.smallAmount}>1 / day</Text>
              <Text style={styles.smallSub}>{t("driver.wallet.cashout.limitSub", "Instant cash out rule")}</Text>
            </View>
          </View>

          {cashoutBlockedToday && lastCashoutAt ? (
            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>{t("driver.wallet.available.lastCashout", "Last cash out")}</Text>
              <Text style={styles.infoSub}>{new Date(lastCashoutAt).toLocaleString(localeForDates)}</Text>
            </View>
          ) : null}

          {driverId ? (
            <Text style={styles.driverDebug}>
              {t("driver.wallet.debug.driver", "Driver")} : {driverId.slice(0, 8)}…
            </Text>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function WalletIcon() {
  return (
    <View style={styles.walletIcon}>
      <View style={styles.walletBody} />
      <View style={styles.walletDot} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  root: { flex: 1, backgroundColor: BG },
  headerRow: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 8,
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: CARD_SOFT,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: { color: BLUE, fontSize: 34, fontWeight: "700", marginTop: -2 },
  headerTitle: { color: TEXT, fontSize: 18, fontWeight: "900", letterSpacing: 0.2 },
  refreshButton: {
    minWidth: 86,
    height: 42,
    borderRadius: 999,
    backgroundColor: CARD_SOFT,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  refreshText: { color: "#E5E7EB", fontWeight: "900", fontSize: 12 },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 32 },
  heroCard: {
    borderRadius: 30,
    padding: 18,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.2)",
    shadowColor: PURPLE_DARK,
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  heroTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  eyebrow: { color: PURPLE, fontSize: 13, fontWeight: "900", letterSpacing: 0.4 },
  heroLabel: { color: MUTED, fontSize: 13, fontWeight: "900", marginTop: 5 },
  statusPill: {
    minHeight: 32,
    borderRadius: 999,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
  },
  statusReady: { backgroundColor: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.24)" },
  statusWarning: { backgroundColor: "rgba(245,158,11,0.1)", borderColor: "rgba(245,158,11,0.24)" },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 7 },
  statusText: { color: TEXT, fontSize: 11, fontWeight: "900" },
  loadingRow: { marginTop: 18, flexDirection: "row", alignItems: "center", gap: 10 },
  loadingText: { color: MUTED, fontWeight: "800" },
  availableAmount: { color: TEXT, fontSize: 42, fontWeight: "900", marginTop: 10, letterSpacing: -1 },
  rulesText: { color: MUTED, marginTop: 8, fontWeight: "800", lineHeight: 19 },
  reasonText: { color: RED, marginTop: 10, fontWeight: "800", lineHeight: 19 },
  cashoutButton: {
    marginTop: 16,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  cashoutReady: { backgroundColor: "rgba(34,197,94,0.14)", borderColor: "rgba(34,197,94,0.55)" },
  cashoutDisabled: { backgroundColor: "rgba(2,6,23,0.55)", borderColor: BORDER, opacity: 0.65 },
  cashoutText: { color: TEXT, fontWeight: "900", fontSize: 15 },
  setupCard: {
    marginTop: 14,
    borderRadius: 24,
    padding: 14,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: "row",
    alignItems: "center",
  },
  cardIconBox: {
    width: 46,
    height: 46,
    borderRadius: 17,
    backgroundColor: "rgba(139,92,246,0.14)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  setupTitle: { color: TEXT, fontWeight: "900", fontSize: 15 },
  setupSub: { color: MUTED, fontWeight: "700", fontSize: 12, marginTop: 4, lineHeight: 17 },
  setupButton: {
    height: 40,
    borderRadius: 14,
    paddingHorizontal: 13,
    backgroundColor: "rgba(139,92,246,0.16)",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.38)",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
  },
  setupButtonText: { color: PURPLE, fontWeight: "900", fontSize: 12 },
  cardsRow: { flexDirection: "row", gap: 12, marginTop: 14 },
  smallCard: {
    flex: 1,
    minHeight: 132,
    borderRadius: 24,
    padding: 15,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    justifyContent: "space-between",
  },
  smallLabel: { color: MUTED, fontWeight: "900", fontSize: 12 },
  smallAmount: { color: TEXT, fontWeight: "900", fontSize: 22, marginTop: 8 },
  smallSub: { color: "#64748B", fontWeight: "800", fontSize: 11, marginTop: 8, lineHeight: 15 },
  infoCard: {
    marginTop: 14,
    borderRadius: 22,
    padding: 14,
    backgroundColor: "rgba(15,23,42,0.62)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  infoTitle: { color: MUTED, fontWeight: "900", fontSize: 12 },
  infoSub: { color: TEXT, fontWeight: "800", marginTop: 5 },
  driverDebug: { color: "#334155", marginTop: 18, fontSize: 11, fontWeight: "700" },
  walletIcon: { width: 26, height: 22, justifyContent: "center" },
  walletBody: {
    position: "absolute",
    width: 25,
    height: 18,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: PURPLE,
  },
  walletDot: {
    position: "absolute",
    right: 4,
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: PURPLE,
  },
});
