import React, { useCallback, useMemo, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { startStripeOnboarding } from "../utils/stripe";

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

function getFunctionErrorMessage(error: any) {
  const contextBody = error?.context?.body;

  if (typeof contextBody === "string" && contextBody.trim()) {
    try {
      const parsed = JSON.parse(contextBody);
      if (typeof parsed?.error === "string") return parsed.error;
      if (typeof parsed?.message === "string") return parsed.message;
    } catch {
      return contextBody;
    }
  }

  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message;
  }

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

        const { data: sessionData, error: sErr } =
          await supabase.auth.getSession();

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

        const { error: syncErr } = await supabase.functions.invoke(
          "check_connect_status",
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          }
        );

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

        const { data: delivered, error: delErr } = await supabase
          .from("orders")
          .select("driver_delivery_payout, delivery_fee, total, tip_cents")
          .eq("driver_id", uid)
          .eq("status", "delivered")
          .eq("driver_paid_out", false);

        if (delErr) throw delErr;

        const available = (delivered ?? []).reduce((sum, o: any) => {
          const base =
            o?.driver_delivery_payout ?? o?.delivery_fee ?? o?.total ?? 0;
          const tipCents = toNumber(o?.tip_cents ?? 0);
          const tip = Math.max(0, tipCents) / 100;

          return sum + toNumber(base) + (Number.isFinite(tip) ? tip : 0);
        }, 0);

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
          const pending = (pendPayouts ?? []).reduce(
            (sum, r: any) => sum + toNumber(r?.amount),
            0
          );
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
          setCashoutBlockedToday(
            Boolean(createdAt && isSameLocalDay(createdAt, new Date()))
          );
        }
      } catch (e: any) {
        console.log("fetchWallet error:", e);
        Alert.alert(
          t("common.errorTitle", "Error"),
          e?.message ?? t("driver.wallet.loadError", "Unable to load wallet.")
        );
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
      return t(
        "driver.wallet.cashoutReason.needStripe",
        "Enable Stripe payouts to cash out."
      );
    }

    if (cashoutBlockedToday) {
      return t(
        "driver.wallet.cashoutReason.alreadyToday",
        "You already requested a cash out today. Try again tomorrow."
      );
    }

    if (availableAmount < MIN_CASHOUT) {
      return t("driver.wallet.cashoutReason.min", "Minimum cash out: {{min}}.", {
        min: fmtMoney(MIN_CASHOUT),
      });
    }

    return "";
  }, [
    stripeAccountId,
    stripeOnboarded,
    cashoutBlockedToday,
    availableAmount,
    t,
  ]);

  const onPressActivateStripe = useCallback(async () => {
    if (loading) return;

    try {
      setLoading(true);
      await startStripeOnboarding("driver");
      await fetchWallet();
    } catch (e: any) {
      Alert.alert(
        t("driver.wallet.stripe.title", "Stripe"),
        e?.message ??
          t(
            "driver.wallet.stripe.startError",
            "Unable to start Stripe onboarding."
          )
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
        cashoutReason ||
          t("driver.wallet.cashoutUnavailable.body", "Cash out unavailable.")
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

              const { data: sessionData, error: sessionErr } =
                await supabase.auth.getSession();

              const accessToken = sessionData?.session?.access_token;

              if (sessionErr || !accessToken) {
                Alert.alert(
                  t("driver.wallet.cashout.title", "Cash out"),
                  t(
                    "driver.wallet.cashout.authError",
                    "Please sign in again."
                  )
                );
                return;
              }

              const { data, error } = await supabase.functions.invoke(
                "pay-driver-now",
                {
                  body: {
                    driver_id: driverId,
                    currency: "USD",
                    source: "mobile_wallet_cashout",
                  },
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                  },
                }
              );

              if (error) {
                const msg = getFunctionErrorMessage(error);
                console.log("pay-driver-now error:", error);

                Alert.alert(
                  t("driver.wallet.cashout.title", "Cash out"),
                  msg ||
                    t(
                      "driver.wallet.cashout.requestError",
                      "Unable to request cash out."
                    )
                );
                return;
              }

              const payload = (data ?? {}) as any;
              const paidAmount =
                payload?.payout_amount ??
                payload?.amount ??
                payload?.total_amount ??
                payload?.total ??
                amountAll;

              Alert.alert(
                t("driver.wallet.cashoutRequested.title", "Cash out requested"),
                t(
                  "driver.wallet.cashoutRequested.body",
                  "Cash out scheduled: {{amount}}.",
                  { amount: fmtMoney(paidAmount) }
                )
              );

              await fetchWallet();
            } catch (e: any) {
              Alert.alert(
                t("driver.wallet.cashout.title", "Cash out"),
                e?.message ??
                  t(
                    "driver.wallet.cashout.runtimeError",
                    "Error during cash out."
                  )
              );
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  }, [
    driverId,
    loading,
    canCashout,
    cashoutReason,
    availableAmount,
    fetchWallet,
    t,
  ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={{ paddingVertical: 8, paddingRight: 10 }}
            >
              <Text style={{ color: "#93C5FD", fontWeight: "900" }}>←</Text>
            </TouchableOpacity>

            <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
              {t("driver.wallet.header.title", "Wallet")}
            </Text>

            <TouchableOpacity
              onPress={() => fetchWallet()}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 999,
                backgroundColor: "rgba(15,23,42,0.7)",
                borderWidth: 1,
                borderColor: "#1F2937",
                opacity: loading ? 0.65 : 1,
              }}
              disabled={loading}
            >
              <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
                {loading
                  ? t("shared.common.loadingEllipsis", "…")
                  : t("shared.common.refresh", "Refresh")}
              </Text>
            </TouchableOpacity>
          </View>

          <Text
            style={{
              color: "white",
              fontSize: 34,
              fontWeight: "900",
              marginTop: 10,
            }}
          >
            {t("driver.wallet.title", "Earnings")}
          </Text>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
          {!stripeOnboarded ? (
            <View
              style={{
                borderRadius: 18,
                backgroundColor: "rgba(15,23,42,0.65)",
                borderWidth: 1,
                borderColor: "#1F2937",
                padding: 16,
                marginBottom: 14,
              }}
            >
              <Text style={{ color: "white", fontWeight: "900", fontSize: 16 }}>
                {t("driver.wallet.stripe.activateTitle", "Enable payouts")}
              </Text>

              <Text
                style={{
                  color: "#94A3B8",
                  marginTop: 8,
                  fontWeight: "700",
                }}
              >
                {t(
                  "driver.wallet.stripe.activateDesc",
                  "Set up Stripe to receive your payouts."
                )}
              </Text>

              <TouchableOpacity
                onPress={onPressActivateStripe}
                disabled={loading}
                style={{
                  marginTop: 12,
                  height: 48,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(59,130,246,0.15)",
                  borderWidth: 1,
                  borderColor: "#3B82F6",
                  opacity: loading ? 0.6 : 1,
                }}
              >
                <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
                  {loading
                    ? t("common.loading", "Loading…")
                    : t("driver.wallet.stripe.activateButton", "Enable Stripe")}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View
            style={{
              borderRadius: 18,
              backgroundColor: "rgba(15,23,42,0.65)",
              borderWidth: 1,
              borderColor: "#1F2937",
              padding: 16,
            }}
          >
            <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
              {t("driver.wallet.available.title", "Available")}
            </Text>

            {loading ? (
              <View
                style={{
                  marginTop: 10,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <ActivityIndicator color="#fff" />
                <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
                  {t("common.loading", "Loading…")}
                </Text>
              </View>
            ) : (
              <>
                <Text
                  style={{
                    color: "white",
                    fontSize: 44,
                    fontWeight: "900",
                    marginTop: 6,
                  }}
                >
                  {fmtMoney(availableAmount)}
                </Text>

                <Text
                  style={{
                    color: "#94A3B8",
                    marginTop: 6,
                    fontWeight: "800",
                  }}
                >
                  {t(
                    "driver.wallet.available.rules",
                    "Minimum cash out: {{min}} • 1 cash out / day",
                    { min: fmtMoney(MIN_CASHOUT) }
                  )}
                </Text>

                {!canCashout && cashoutReason ? (
                  <Text
                    style={{
                      color: "#FCA5A5",
                      marginTop: 8,
                      fontWeight: "800",
                    }}
                  >
                    {cashoutReason}
                  </Text>
                ) : null}

                <TouchableOpacity
                  onPress={onPressCashout}
                  disabled={loading || !canCashout}
                  style={{
                    marginTop: 14,
                    height: 52,
                    borderRadius: 14,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: canCashout
                      ? "rgba(34,197,94,0.12)"
                      : "rgba(2,6,23,0.55)",
                    borderWidth: 1,
                    borderColor: canCashout ? "#22C55E" : "#1F2937",
                    opacity: loading || !canCashout ? 0.6 : 1,
                  }}
                >
                  <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
                    {t("driver.wallet.available.cashoutButton", "Cash out")}
                  </Text>
                </TouchableOpacity>

                {cashoutBlockedToday && lastCashoutAt ? (
                  <Text
                    style={{
                      color: "#64748B",
                      marginTop: 10,
                      fontWeight: "800",
                      fontSize: 12,
                    }}
                  >
                    {t("driver.wallet.available.lastCashout", "Last cash out")}{" "}
                    : {new Date(lastCashoutAt).toLocaleString(localeForDates)}
                  </Text>
                ) : null}
              </>
            )}
          </View>

          <View
            style={{
              marginTop: 14,
              borderRadius: 18,
              backgroundColor: "rgba(15,23,42,0.45)",
              borderWidth: 1,
              borderColor: "#1F2937",
              padding: 16,
            }}
          >
            <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
              {t("driver.wallet.pending.title", "Pending")}
            </Text>

            <Text
              style={{
                color: "white",
                fontSize: 26,
                fontWeight: "900",
                marginTop: 6,
              }}
            >
              {fmtMoney(pendingAmount)}
            </Text>

            <Text style={{ color: "#94A3B8", marginTop: 6, fontWeight: "800" }}>
              {t(
                "driver.wallet.pending.desc",
                "Cash outs in progress (scheduled / processing)"
              )}
            </Text>
          </View>

          {driverId ? (
            <Text style={{ color: "#334155", marginTop: 18, fontSize: 11 }}>
              {t("driver.wallet.debug.driver", "Driver")} :{" "}
              {driverId.slice(0, 8)}…
            </Text>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}