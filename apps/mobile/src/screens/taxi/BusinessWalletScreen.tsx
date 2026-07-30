import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
  TextInput,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import { supabase } from "../../lib/supabase";
import { getApiBaseUrl } from "../../lib/apiBase";
import { formatWalletAmount } from "../../lib/walletApi";
import { toUserFacingError } from "../../lib/userFacingError";
import { APP_COLORS } from "../../theme/appTheme";
import * as WebBrowser from "expo-web-browser";

type Summary = {
  balance_cents?: number;
  available_cents?: number;
  currency?: string;
  can_cashout?: boolean;
  connect?: {
    stripe_account_id?: string | null;
    stripe_onboarding_status?: string | null;
    stripe_payouts_enabled?: boolean;
  };
  business_account_id?: string;
  role?: string;
  account?: { id: string; name: string } | null;
};

type HistoryItem = {
  id: string;
  direction: string;
  amount_cents: number;
  currency: string;
  entry_type: string;
  status: string;
  description: string | null;
  created_at: string;
};

async function authJson(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Session expired");
  const base = getApiBaseUrl().replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      String((json as { error?: string }).error ?? `HTTP ${res.status}`)
    );
  }
  return json;
}

function statusColor(status: string) {
  const s = status.toLowerCase();
  if (s === "paid" || s === "posted" || s === "refunded") return "#22C55E";
  if (s === "failed" || s === "canceled") return "#FCA5A5";
  return "#F59E0B";
}

export default function BusinessWalletScreen() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [topupCents, setTopupCents] = useState("5000");
  const [cashoutCents, setCashoutCents] = useState("");
  const [busy, setBusy] = useState(false);

  const currency = summary?.currency ?? "USD";
  const fmt = useCallback(
    (cents: number) => formatWalletAmount(cents, currency),
    [currency]
  );

  const buckets = useMemo(() => {
    const pending = items.filter((i) =>
      ["pending", "processing"].includes(String(i.status).toLowerCase())
    );
    const paid = items.filter((i) =>
      ["paid", "posted", "refunded"].includes(String(i.status).toLowerCase())
    );
    return { pending, paid };
  }, [items]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [sum, hist] = await Promise.all([
        authJson("/api/taxi/business/wallet/summary"),
        authJson("/api/taxi/business/wallet/history?limit=50"),
      ]);
      setSummary(sum as Summary);
      setItems(((hist as { items?: HistoryItem[] }).items ?? []) as HistoryItem[]);
    } catch (e) {
      setError(toUserFacingError(e, "Unable to load business wallet"));
      setSummary(null);
      setItems([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void refresh().finally(() => setLoading(false));
    }, [refresh])
  );

  async function onRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  async function onTopup() {
    const amount = Math.round(Number(topupCents));
    if (!summary?.business_account_id || !Number.isFinite(amount) || amount < 500) {
      Alert.alert(
        t("business.wallet.topupMin", "Minimum top-up"),
        t("business.wallet.topupMinBody", "Enter at least $5.00 (500 cents).")
      );
      return;
    }
    setBusy(true);
    try {
      const out = await authJson(
        "/api/stripe/client/create-business-wallet-topup-session",
        {
          method: "POST",
          body: JSON.stringify({
            business_account_id: summary.business_account_id,
            amount_cents: amount,
          }),
        }
      );
      const url = String((out as { url?: string }).url ?? "");
      if (!url) throw new Error("Checkout URL missing");
      await WebBrowser.openBrowserAsync(url);
      await refresh();
    } catch (e) {
      Alert.alert(t("common.errorTitle", "Error"), toUserFacingError(e, "Top-up failed"));
    } finally {
      setBusy(false);
    }
  }

  async function onCashout() {
    const amount = Math.round(Number(cashoutCents));
    if (!summary?.business_account_id || !Number.isFinite(amount) || amount <= 0) {
      Alert.alert(
        t("business.wallet.cashoutInvalid", "Invalid amount"),
        t("business.wallet.cashoutInvalidBody", "Enter a positive cash-out amount in cents.")
      );
      return;
    }
    setBusy(true);
    try {
      await authJson("/api/taxi/business/wallet/summary", {
        method: "POST",
        body: JSON.stringify({
          action: "cashout",
          business_account_id: summary.business_account_id,
          amount_cents: amount,
        }),
      });
      Alert.alert(
        t("business.wallet.cashoutOk", "Cash-out submitted"),
        t("business.wallet.cashoutOkBody", "Transfer to Connect was created.")
      );
      setCashoutCents("");
      await refresh();
    } catch (e) {
      Alert.alert(
        t("common.errorTitle", "Error"),
        toUserFacingError(e, "Cash-out failed")
      );
    } finally {
      setBusy(false);
    }
  }

  async function onConnect() {
    if (!summary?.business_account_id) return;
    setBusy(true);
    try {
      // Reuse edge create_connect_account with role=business
      const { data, error } = await supabase.functions.invoke("create_connect_account", {
        body: {
          role: "business",
          business_account_id: summary.business_account_id,
        },
      });
      if (error) throw error;
      const url =
        String((data as { onboarding_url?: string; login_url?: string })?.onboarding_url ?? "") ||
        String((data as { login_url?: string })?.login_url ?? "");
      if (!url) throw new Error("Connect URL missing");
      await WebBrowser.openBrowserAsync(url);
      await refresh();
    } catch (e) {
      Alert.alert(
        t("common.errorTitle", "Error"),
        toUserFacingError(e, "Unable to open Stripe Connect")
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
        <ScreenHeader
          title={t("business.wallet.title", "Business Wallet")}
          fallbackRoute="TaxiHome"
          variant="dark"
        />
        <View style={styles.centered}>
          <ActivityIndicator color={APP_COLORS.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("business.wallet.title", "Business Wallet")}
        subtitle={
          summary?.account?.name ??
          t("business.wallet.subtitle", "Corporate prepaid balance")
        }
        fallbackRoute="TaxiHome"
        variant="dark"
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
      >
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => void refresh()} style={styles.retry}>
              <Text style={styles.retryText}>{t("common.retry", "Retry")}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!error && !summary ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>
              {t("business.wallet.emptyTitle", "No business account")}
            </Text>
            <Text style={styles.emptyBody}>
              {t(
                "business.wallet.emptyBody",
                "Ask an admin to add you as a business member to use the corporate wallet."
              )}
            </Text>
          </View>
        ) : null}

        {summary ? (
          <>
            <View style={styles.card}>
              <Text style={styles.muted}>
                {t("business.wallet.available", "Available balance")}
              </Text>
              <Text style={styles.balance}>
                {fmt(Number(summary.balance_cents ?? summary.available_cents ?? 0))}
              </Text>
              <Text style={styles.mutedSmall}>
                {t("business.wallet.role", "Role")}: {summary.role ?? "—"} ·{" "}
                {summary.connect?.stripe_payouts_enabled
                  ? t("business.wallet.connectReady", "Connect ready")
                  : t("business.wallet.connectNeeded", "Connect setup needed")}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>
                {t("business.wallet.topup", "Top up")}
              </Text>
              <TextInput
                value={topupCents}
                onChangeText={setTopupCents}
                keyboardType="number-pad"
                placeholder="Amount in cents"
                placeholderTextColor="#64748B"
                style={styles.input}
              />
              <TouchableOpacity
                style={[styles.primaryBtn, busy && { opacity: 0.7 }]}
                disabled={busy}
                onPress={() => void onTopup()}
              >
                <Text style={styles.primaryLabel}>
                  {t("business.wallet.topupCta", "Top up with Stripe")}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>
                {t("business.wallet.cashout", "Cash out")}
              </Text>
              <TextInput
                value={cashoutCents}
                onChangeText={setCashoutCents}
                keyboardType="number-pad"
                placeholder="Amount in cents"
                placeholderTextColor="#64748B"
                style={styles.input}
              />
              <TouchableOpacity
                style={[styles.secondaryBtn, busy && { opacity: 0.7 }]}
                disabled={busy || !summary.can_cashout}
                onPress={() => void onCashout()}
              >
                <Text style={styles.secondaryLabel}>
                  {summary.can_cashout
                    ? t("business.wallet.cashoutCta", "Transfer to Connect")
                    : t("business.wallet.cashoutBlocked", "Cash-out unavailable")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.linkBtn} onPress={() => void onConnect()}>
                <Text style={styles.linkLabel}>
                  {t("business.wallet.connect", "Manage Stripe Connect")}
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>
              {t("business.wallet.history", "History")}
            </Text>
            {items.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyBody}>
                  {t(
                    "business.wallet.noTx",
                    "No transactions yet. Top up to fund corporate rides."
                  )}
                </Text>
              </View>
            ) : (
              items.map((item) => (
                <View key={item.id} style={styles.txRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.txTitle}>
                      {item.entry_type} · {item.direction}
                    </Text>
                    <Text style={styles.txMeta}>
                      {new Date(item.created_at).toLocaleString()} ·{" "}
                      <Text style={{ color: statusColor(item.status) }}>
                        {item.status}
                      </Text>
                    </Text>
                    {item.description ? (
                      <Text style={styles.txMeta}>{item.description}</Text>
                    ) : null}
                  </View>
                  <Text
                    style={[
                      styles.txAmount,
                      {
                        color:
                          item.direction === "credit" ? "#86EFAC" : "#FCA5A5",
                      },
                    ]}
                  >
                    {item.direction === "credit" ? "+" : "−"}
                    {fmt(item.amount_cents)}
                  </Text>
                </View>
              ))
            )}

            <Text style={[styles.mutedSmall, { marginTop: 12 }]}>
              {t("business.wallet.buckets", "Pending {{p}} · Settled {{s}}", {
                p: buckets.pending.length,
                s: buckets.paid.length,
              })}
            </Text>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: APP_COLORS.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: "rgba(15,23,42,0.86)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.14)",
    padding: 16,
    marginBottom: 14,
  },
  muted: { color: "#94A3B8", fontWeight: "700", fontSize: 12 },
  mutedSmall: { color: "#64748B", fontWeight: "600", fontSize: 12, marginTop: 8 },
  balance: { color: "#F8FAFC", fontSize: 32, fontWeight: "900", marginTop: 6 },
  sectionTitle: {
    color: "#E2E8F0",
    fontWeight: "900",
    fontSize: 15,
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.22)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: "#F8FAFC",
    marginBottom: 10,
    backgroundColor: "rgba(2,6,23,0.4)",
  },
  primaryBtn: {
    backgroundColor: "#F59E0B",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryLabel: { color: "#0F172A", fontWeight: "900" },
  secondaryBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.3)",
  },
  secondaryLabel: { color: "#E2E8F0", fontWeight: "800" },
  linkBtn: { marginTop: 12, alignItems: "center" },
  linkLabel: { color: "#93C5FD", fontWeight: "700" },
  txRow: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(148,163,184,0.12)",
  },
  txTitle: { color: "#F8FAFC", fontWeight: "800", textTransform: "capitalize" },
  txMeta: { color: "#94A3B8", fontSize: 12, marginTop: 3 },
  txAmount: { fontWeight: "900", fontSize: 14 },
  errorBox: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: "rgba(239,68,68,0.12)",
    marginBottom: 12,
  },
  errorText: { color: "#FCA5A5", fontWeight: "700" },
  retry: { marginTop: 10 },
  retryText: { color: "#F59E0B", fontWeight: "800" },
  emptyBox: {
    padding: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.16)",
    marginBottom: 12,
  },
  emptyTitle: { color: "#F8FAFC", fontWeight: "900", marginBottom: 6 },
  emptyBody: { color: "#94A3B8", lineHeight: 20 },
});
