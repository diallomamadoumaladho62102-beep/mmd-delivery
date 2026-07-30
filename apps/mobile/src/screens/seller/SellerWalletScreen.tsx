import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import { supabase } from "../../lib/supabase";
import { getApiBaseUrl } from "../../lib/apiBase";
import { formatWalletAmount, fetchWalletSummary } from "../../lib/walletApi";
import { startStripeOnboarding } from "../../utils/stripe";
import { toUserFacingError } from "../../lib/userFacingError";
import { APP_COLORS } from "../../theme/appTheme";
import {
  normalizeStripeConnectStatus,
  stripeConnectStatusLabel,
  stripeConnectUserMessage,
} from "../../lib/stripeConnectStatus";

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

function statusColor(status: string) {
  const s = status.toLowerCase();
  if (["paid", "posted", "refunded"].includes(s)) return "#22C55E";
  if (["failed", "canceled", "cancelled", "refund_failed"].includes(s))
    return "#FCA5A5";
  return "#F59E0B";
}

export default function SellerWalletScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [balanceCents, setBalanceCents] = useState(0);
  const [availableCents, setAvailableCents] = useState(0);
  const [awaitingCents, setAwaitingCents] = useState(0);
  const [paidOutCents, setPaidOutCents] = useState(0);
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

      const base = getApiBaseUrl().replace(/\/$/, "");
      const [summary, activityRes, connectRes] = await Promise.all([
        fetchWalletSummary(token, { accountType: "seller", countryCode: "US" }),
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
      setPaidOutCents(Number((summary as { paid_out_cents?: number }).paid_out_cents ?? 0));
      setFeesCents(
        Number((summary as { platform_fees_cents?: number }).platform_fees_cents ?? 0)
      );
      setRefundedCents(
        Number((summary as { refunded_cents?: number }).refunded_cents ?? 0)
      );
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
      setError(toUserFacingError(e, "Unable to load seller wallet"));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void refresh().finally(() => setLoading(false));
    }, [refresh])
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
        <ScreenHeader
          title={t("seller.wallet.title", "Seller Wallet")}
          fallbackRoute="SellerDashboard"
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
        title={t("seller.wallet.title", "Seller Wallet")}
        subtitle={t(
          "seller.wallet.subtitle",
          "Marketplace earnings via Stripe Connect"
        )}
        fallbackRoute="SellerDashboard"
        variant="dark"
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void refresh().finally(() => setRefreshing(false));
            }}
          />
        }
      >
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => void refresh()}>
              <Text style={styles.retry}>{t("common.retry", "Retry")}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.muted}>
            {t("seller.wallet.awaiting", "Awaiting transfer")}
          </Text>
          <Text style={styles.balance}>{fmt(awaitingCents)}</Text>
          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={styles.muted}>
                {t("seller.wallet.paidOut", "Paid out")}
              </Text>
              <Text style={styles.statValue}>{fmt(paidOutCents || availableCents)}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.muted}>
                {t("seller.wallet.fees", "Commissions")}
              </Text>
              <Text style={styles.statValue}>{fmt(feesCents)}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.muted}>
                {t("seller.wallet.refunds", "Refunds")}
              </Text>
              <Text style={styles.statValue}>{fmt(refundedCents)}</Text>
            </View>
          </View>
          {note ? <Text style={styles.note}>{note}</Text> : null}
          <Text style={styles.note}>
            {t("seller.wallet.ledger", "Ledger")}: {fmt(balanceCents)}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>
            {t("seller.wallet.connect", "Stripe Connect")}
          </Text>
          <Text style={styles.statValue}>{stripeLabel}</Text>
          <Text style={styles.note}>{stripeMessage}</Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => {
              void startStripeOnboarding("seller").catch((e) =>
                Alert.alert(
                  t("common.errorTitle", "Error"),
                  toUserFacingError(e, "Unable to open Stripe")
                )
              );
            }}
          >
            <Text style={styles.primaryLabel}>
              {t("seller.wallet.manageConnect", "Manage payouts")}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>
          {t("seller.wallet.activity", "Activity")}
        </Text>
        <Text style={styles.note}>
          {t("seller.wallet.buckets", "Pending {{p}} · Paid {{paid}} · Refunds {{r}}", {
            p: buckets.pending.length,
            paid: buckets.paid.length,
            r: buckets.refunds.length,
          })}
        </Text>

        {items.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>
              {t("seller.wallet.emptyTitle", "No payouts yet")}
            </Text>
            <Text style={styles.emptyBody}>
              {t(
                "seller.wallet.emptyBody",
                "When marketplace orders are paid, seller payouts and transfers appear here."
              )}
            </Text>
            <TouchableOpacity
              style={styles.linkBtn}
              onPress={() => navigation.navigate("SellerOrders")}
            >
              <Text style={styles.linkLabel}>
                {t("seller.wallet.viewOrders", "View orders")}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          items.map((item) => (
            <View key={item.id} style={styles.txRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.txTitle}>{item.title}</Text>
                <Text style={styles.txMeta}>
                  {new Date(item.created_at).toLocaleString()} ·{" "}
                  <Text style={{ color: statusColor(item.status) }}>
                    {item.status}
                  </Text>
                </Text>
                {item.subtitle ? (
                  <Text style={styles.txMeta}>{item.subtitle}</Text>
                ) : null}
                {item.stripe_transfer_id ? (
                  <Text style={styles.txMeta}>SCT {item.stripe_transfer_id}</Text>
                ) : null}
                {item.stripe_refund_id ? (
                  <Text style={styles.txMeta}>Refund {item.stripe_refund_id}</Text>
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
  balance: { color: "#F8FAFC", fontSize: 32, fontWeight: "900", marginTop: 6 },
  statRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  stat: { flex: 1 },
  statValue: { color: "#E2E8F0", fontWeight: "800", marginTop: 4 },
  note: { color: "#64748B", marginTop: 10, fontSize: 12, lineHeight: 18 },
  sectionTitle: {
    color: "#E2E8F0",
    fontWeight: "900",
    fontSize: 15,
    marginBottom: 8,
    marginTop: 4,
  },
  primaryBtn: {
    marginTop: 12,
    backgroundColor: "#F59E0B",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryLabel: { color: "#0F172A", fontWeight: "900" },
  txRow: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(148,163,184,0.12)",
  },
  txTitle: { color: "#F8FAFC", fontWeight: "800" },
  txMeta: { color: "#94A3B8", fontSize: 12, marginTop: 3 },
  txAmount: { fontWeight: "900" },
  errorBox: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: "rgba(239,68,68,0.12)",
    marginBottom: 12,
  },
  errorText: { color: "#FCA5A5", fontWeight: "700" },
  retry: { color: "#F59E0B", fontWeight: "800", marginTop: 8 },
  emptyBox: {
    padding: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.16)",
    marginTop: 8,
  },
  emptyTitle: { color: "#F8FAFC", fontWeight: "900", marginBottom: 6 },
  emptyBody: { color: "#94A3B8", lineHeight: 20 },
  linkBtn: { marginTop: 12 },
  linkLabel: { color: "#93C5FD", fontWeight: "800" },
});
