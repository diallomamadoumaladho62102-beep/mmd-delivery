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
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import { ClientServiceBottomNav } from "../../components/navigation/ClientServiceBottomNav";
import { supabase } from "../../lib/supabase";
import { getApiBaseUrl } from "../../lib/apiBase";
import { formatWalletAmount } from "../../lib/walletApi";
import { toUserFacingError } from "../../lib/userFacingError";
import { formatDateTime } from "../../i18n/formatters";
import { resolveWalletLinkedJob } from "../../lib/walletLinkedJob";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import * as WebBrowser from "expo-web-browser";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GLASS,
  MMD_GOLD_BRIGHT,
  MMD_GOLD_CLASSIC,
  MMD_GOLD_CLASSIC_BORDER,
  MMD_MUTED,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../../theme/mmdUi";

type Nav = NativeStackNavigationProp<RootStackParamList>;

type Summary = {
  balance_cents?: number;
  available_cents?: number;
  currency?: string;
  can_cashout?: boolean;
  can_manage?: boolean;
  can_topup?: boolean;
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
  reference_type?: string | null;
  reference_id?: string | null;
};

type MemberRow = {
  id: string;
  role: string;
  active: boolean;
  full_name: string | null;
  email: string | null;
};

type FilterKey = "all" | "credit" | "debit";

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

function entryLabel(
  item: HistoryItem,
  t: (k: string, f: string) => string
): string {
  const raw = String(item.description ?? "").trim();
  if (raw) return raw;
  const type = String(item.entry_type ?? item.direction).replace(/_/g, " ");
  if (type === "topup") return t("business.wallet.tx.topup", "Account top up");
  if (type === "cashout") return t("business.wallet.tx.cashout", "Cash out");
  if (type === "ride_debit") return t("business.wallet.tx.ride", "Trip payment");
  return type;
}

export default function BusinessWalletScreen() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<Nav>();
  const route = useRoute();
  const params = (route.params ?? {}) as RootStackParamList["BusinessWallet"];
  const view = params?.view ?? "wallet";

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [canInvite, setCanInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [topupCents, setTopupCents] = useState("");
  const [cashoutCents, setCashoutCents] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [topupSuccessCents, setTopupSuccessCents] = useState<number | null>(null);

  const currency = summary?.currency ?? "USD";
  const fmt = useCallback(
    (cents: number) => formatWalletAmount(cents, currency),
    [currency]
  );
  const canManage = Boolean(summary?.can_manage ?? summary?.can_topup);
  const isAdmin = ["admin", "manager"].includes(String(summary?.role ?? "").toLowerCase());

  const filteredItems = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((i) => String(i.direction).toLowerCase() === filter);
  }, [items, filter]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [sum, hist] = await Promise.all([
        authJson("/api/taxi/business/wallet/summary"),
        authJson("/api/taxi/business/wallet/history?limit=50"),
      ]);
      setSummary(sum as Summary);
      setItems(((hist as { items?: HistoryItem[] }).items ?? []) as HistoryItem[]);
      try {
        const mem = await authJson("/api/taxi/business/members");
        setMembers(((mem as { members?: MemberRow[] }).members ?? []) as MemberRow[]);
        setCanInvite(Boolean((mem as { can_invite?: boolean }).can_invite));
      } catch {
        setMembers([]);
        setCanInvite(false);
      }
    } catch (e) {
      setError(
        toUserFacingError(
          e,
          t("business.wallet.loadFailed", "Unable to load the business wallet.")
        )
      );
      setSummary(null);
      setItems([]);
    }
  }, [t]);

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

  function setView(next: "wallet" | "transactions" | "members") {
    navigation.setParams({ view: next } as never);
  }

  function openLinked(item: HistoryItem) {
    const linked = resolveWalletLinkedJob(item);
    if (!linked) return;
    if (linked.kind === "taxi_ride") {
      navigation.navigate("TaxiRideTracking", { rideId: linked.id });
      return;
    }
    if (linked.kind === "order") {
      navigation.navigate("ClientOrderDetails", { orderId: linked.id });
      return;
    }
    navigation.navigate("ClientDeliveryRequestDetails", { requestId: linked.id });
  }

  async function onTopup() {
    const amount = Math.round(Number(topupCents));
    if (!summary?.business_account_id || !Number.isFinite(amount) || amount < 500) {
      Alert.alert(
        t("business.wallet.topupMin", "Minimum top-up"),
        t("business.wallet.topupMinBody", "Enter at least 500 cents.")
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
      const before = Number(summary.balance_cents ?? 0);
      await refresh();
      setTopupSuccessCents(amount);
      void before;
    } catch (e) {
      Alert.alert(
        t("common.errorTitle", "Error"),
        toUserFacingError(e, t("business.wallet.topupFailed", "Top-up failed."))
      );
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
        toUserFacingError(e, t("business.wallet.cashoutFailed", "Cash-out failed."))
      );
    } finally {
      setBusy(false);
    }
  }

  async function onInvite() {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      Alert.alert(
        t("business.wallet.inviteInvalid", "Invalid email"),
        t("business.wallet.inviteInvalidBody", "Enter a valid email to invite.")
      );
      return;
    }
    setBusy(true);
    try {
      await authJson("/api/taxi/business/members/invite", {
        method: "POST",
        body: JSON.stringify({
          email,
          role: "employee",
          business_account_id: summary?.business_account_id,
        }),
      });
      setInviteEmail("");
      await refresh();
      Alert.alert(
        t("business.wallet.inviteSent", "Invite sent"),
        t("business.wallet.inviteSentBody", "The teammate will appear once they accept.")
      );
    } catch (e) {
      Alert.alert(
        t("common.errorTitle", "Error"),
        toUserFacingError(e, t("business.wallet.inviteFailed", "Unable to invite this member."))
      );
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <ScreenHeader
      title={
        view === "members"
          ? t("business.wallet.teamTitle", "Team members")
          : view === "transactions"
            ? t("business.wallet.history", "History")
            : t("business.wallet.title", "Business Wallet")
      }
      subtitle={
        summary?.account?.name ??
        t("business.wallet.subtitle", "Corporate prepaid balance")
      }
      fallbackRoute="TaxiHome"
      variant="dark"
    />
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
        {header}
        <View style={styles.centered}>
          <View style={styles.loadingCard}>
            <ActivityIndicator color={MMD_GOLD_BRIGHT} />
            <Text style={styles.loadingText}>{t("common.loading", "Loading…")}</Text>
          </View>
        </View>
        <ClientServiceBottomNav active="home" appearance="glass" accent="gold" layout="edge" />
      </SafeAreaView>
    );
  }

  if (topupSuccessCents != null && summary) {
    return (
      <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
        {header}
        <View style={styles.centered}>
          <View style={styles.successCard}>
            <View style={styles.checkCircle}>
              <Text style={styles.checkMark}>✓</Text>
            </View>
            <Text style={styles.successTitle}>
              {t("business.wallet.topupSuccess", "Top up successful!")}
            </Text>
            <Text style={styles.successAmount}>{fmt(topupSuccessCents)}</Text>
            {summary.account?.name ? (
              <Text style={styles.successMeta}>
                {t("business.wallet.addedTo", "Added to {{name}}", {
                  name: summary.account.name,
                })}
              </Text>
            ) : null}
            <View style={styles.balancePill}>
              <Text style={styles.balancePillText}>
                {t("business.wallet.newBalance", "New balance: {{amount}}", {
                  amount: fmt(Number(summary.balance_cents ?? summary.available_cents ?? 0)),
                })}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => setTopupSuccessCents(null)}
          >
            <Text style={styles.primaryLabel}>{t("common.done", "Done")}</Text>
          </TouchableOpacity>
        </View>
        <ClientServiceBottomNav active="home" appearance="glass" accent="gold" layout="edge" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
      {header}
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={MMD_GOLD_BRIGHT}
          />
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
            <View style={styles.emptyIcon}>
              <Text style={{ fontSize: 28 }}>💼</Text>
            </View>
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

        {summary && view === "wallet" ? (
          <>
            <View style={styles.balanceCard}>
              <Text style={styles.muted}>
                {t("business.wallet.available", "Available balance")}
              </Text>
              <Text style={styles.balance}>
                {fmt(Number(summary.balance_cents ?? summary.available_cents ?? 0))}
              </Text>
            </View>

            {canManage ? (
              <>
                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>
                    {t("business.wallet.topup", "Top up")}
                  </Text>
                  <TextInput
                    value={topupCents}
                    onChangeText={setTopupCents}
                    keyboardType="number-pad"
                    placeholder={t("business.wallet.amountCents", "Amount in cents")}
                    placeholderTextColor="rgba(255,255,255,0.45)"
                    style={styles.input}
                  />
                  <TouchableOpacity
                    style={[styles.primaryBtn, busy && { opacity: 0.7 }]}
                    disabled={busy}
                    onPress={() => void onTopup()}
                  >
                    <Text style={styles.primaryLabel}>
                      {t("business.wallet.topupCta", "Top up")}
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
                    placeholder={t("business.wallet.amount", "Amount")}
                    placeholderTextColor="rgba(255,255,255,0.45)"
                    style={styles.input}
                  />
                  <TouchableOpacity
                    style={[styles.primaryBtn, (busy || !summary.can_cashout) && { opacity: 0.7 }]}
                    disabled={busy || !summary.can_cashout}
                    onPress={() => void onCashout()}
                  >
                    <Text style={styles.primaryLabel}>
                      {summary.can_cashout
                        ? t("business.wallet.cashoutCta", "Cash out")
                        : t("business.wallet.cashoutBlocked", "Cash-out unavailable")}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <View style={styles.card}>
                <Text style={styles.readOnly}>
                  {t(
                    "business.wallet.readOnly",
                    "Read-only access. Ask an admin to top up or cash out."
                  )}
                </Text>
              </View>
            )}

            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>
                {t("business.wallet.history", "History")}
              </Text>
              <TouchableOpacity onPress={() => setView("transactions")}>
                <Text style={styles.linkLabel}>{t("common.seeAll", "See all")}</Text>
              </TouchableOpacity>
            </View>
            {items.length === 0 ? (
              <Text style={styles.emptyBody}>
                {t(
                  "business.wallet.noTx",
                  "No transactions yet. Top up to fund corporate rides."
                )}
              </Text>
            ) : (
              items.slice(0, 6).map((item) => (
                <HistoryRow
                  key={item.id}
                  item={item}
                  label={entryLabel(item, t)}
                  amount={fmt(item.amount_cents)}
                  date={formatDateTime(item.created_at, i18n.language)}
                  onPress={() => openLinked(item)}
                />
              ))
            )}

            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setView("members")}>
              <Text style={styles.secondaryLabel}>
                {t("business.wallet.manageTeam", "Team members")}
              </Text>
            </TouchableOpacity>
          </>
        ) : null}

        {summary && view === "transactions" ? (
          <>
            <View style={styles.filterBar}>
              {(["all", "credit", "debit"] as FilterKey[]).map((key) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.filterTab, filter === key && styles.filterTabOn]}
                  onPress={() => setFilter(key)}
                >
                  <Text style={[styles.filterText, filter === key && styles.filterTextOn]}>
                    {key === "all"
                      ? t("business.wallet.filterAll", "All")
                      : key === "credit"
                        ? t("business.wallet.filterCredits", "Credits")
                        : t("business.wallet.filterDebits", "Debits")}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {filteredItems.length === 0 ? (
              <Text style={styles.emptyBody}>
                {t("business.wallet.noTx", "No transactions yet.")}
              </Text>
            ) : (
              filteredItems.map((item) => (
                <HistoryRow
                  key={item.id}
                  item={item}
                  label={entryLabel(item, t)}
                  amount={fmt(item.amount_cents)}
                  date={formatDateTime(item.created_at, i18n.language)}
                  onPress={() => openLinked(item)}
                />
              ))
            )}
          </>
        ) : null}

        {summary && view === "members" ? (
          <>
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.muted}>{t("business.wallet.members", "Members")}</Text>
                <Text style={styles.statValue}>
                  {t("business.wallet.membersActive", "{{n}} active", {
                    n: members.filter((m) => m.active).length,
                  })}
                </Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.muted}>{t("business.wallet.available", "Balance")}</Text>
                <Text style={styles.statValue}>
                  {fmt(Number(summary.balance_cents ?? summary.available_cents ?? 0))}
                </Text>
              </View>
            </View>
            {members.length === 0 ? (
              <Text style={styles.emptyBody}>
                {t("business.wallet.noMembers", "No team members to show.")}
              </Text>
            ) : (
              members.map((m) => {
                const name =
                  String(m.full_name ?? "").trim() ||
                  String(m.email ?? "").trim() ||
                  t("business.wallet.member", "Member");
                const initial = name.slice(0, 1).toUpperCase();
                const roleLabel =
                  String(m.role).toLowerCase() === "admin" ||
                  String(m.role).toLowerCase() === "manager"
                    ? t("business.wallet.admin", "Admin")
                    : t("business.wallet.member", "Member");
                return (
                  <View key={m.id} style={styles.memberRow}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{initial}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{name}</Text>
                      <Text style={styles.memberRole}>{roleLabel}</Text>
                    </View>
                  </View>
                );
              })
            )}
            {canInvite || isAdmin ? (
              <>
                <TextInput
                  value={inviteEmail}
                  onChangeText={setInviteEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholder={t("business.wallet.inviteEmail", "Invite email")}
                  placeholderTextColor="rgba(255,255,255,0.45)"
                  style={styles.input}
                />
                <TouchableOpacity
                  style={[styles.primaryBtn, busy && { opacity: 0.7 }]}
                  disabled={busy}
                  onPress={() => void onInvite()}
                >
                  <Text style={styles.primaryLabel}>
                    {t("business.wallet.invite", "Invite member")}
                  </Text>
                </TouchableOpacity>
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>
      <ClientServiceBottomNav active="home" appearance="glass" accent="gold" layout="edge" />
    </SafeAreaView>
  );
}

function HistoryRow({
  label,
  amount,
  date,
  item,
  onPress,
}: {
  label: string;
  amount: string;
  date: string;
  item: HistoryItem;
  onPress: () => void;
}) {
  const credit = String(item.direction).toLowerCase() === "credit";
  const linked = resolveWalletLinkedJob(item);
  return (
    <TouchableOpacity
      style={styles.txRow}
      onPress={onPress}
      disabled={!linked}
      activeOpacity={linked ? 0.85 : 1}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.txTitle}>{label}</Text>
        <Text style={styles.txMeta}>{date}</Text>
      </View>
      <Text style={[styles.txAmount, { color: credit ? MMD_TAXI_GREEN : "#EF4444" }]}>
        {credit ? "+" : "−"}
        {amount}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MMD_BLUE },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  content: { padding: 16, paddingBottom: 120, gap: 14 },
  loadingCard: {
    width: "100%",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
    backgroundColor: MMD_GLASS,
    padding: 32,
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontSize: 16,
  },
  balanceCard: {
    backgroundColor: MMD_GLASS,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
    padding: 20,
  },
  card: {
    backgroundColor: MMD_GLASS,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
    padding: 16,
    gap: 12,
  },
  muted: {
    color: "rgba(255,255,255,0.8)",
    fontFamily: MMD_FONT.bold,
    fontSize: 14,
  },
  balance: {
    color: MMD_WHITE,
    fontSize: 32,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    marginTop: 6,
  },
  sectionTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 15,
  },
  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  input: {
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: MMD_WHITE,
    backgroundColor: "rgba(255,255,255,0.1)",
    fontFamily: MMD_FONT.regular,
  },
  primaryBtn: {
    backgroundColor: MMD_TAXI_GREEN,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    width: "100%",
  },
  primaryLabel: {
    color: MMD_BLUE,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
  },
  secondaryBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
    backgroundColor: MMD_GLASS,
  },
  secondaryLabel: {
    color: MMD_WHITE,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
  },
  linkLabel: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: MMD_GLASS,
    borderRadius: 16,
    borderBottomWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 56,
  },
  txTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
  },
  txMeta: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 12,
    marginTop: 3,
    fontFamily: MMD_FONT.regular,
  },
  txAmount: {
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
    fontSize: 14,
  },
  errorBox: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: "rgba(239,68,68,0.12)",
  },
  errorText: { color: "#FCA5A5", fontWeight: "700", fontFamily: MMD_FONT.bold },
  retry: { marginTop: 10 },
  retryText: {
    color: MMD_GOLD_BRIGHT,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
  },
  emptyBox: {
    padding: 32,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
    backgroundColor: MMD_GLASS,
    alignItems: "center",
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    color: MMD_WHITE,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
    fontSize: 18,
    marginBottom: 8,
    textAlign: "center",
  },
  emptyBody: {
    color: MMD_MUTED,
    lineHeight: 20,
    fontFamily: MMD_FONT.regular,
    textAlign: "center",
  },
  readOnly: {
    color: "rgba(255,255,255,0.8)",
    fontFamily: MMD_FONT.regular,
    lineHeight: 20,
  },
  successCard: {
    width: "100%",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
    backgroundColor: MMD_GLASS,
    padding: 24,
    alignItems: "center",
    marginBottom: 16,
  },
  checkCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: MMD_TAXI_GREEN,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  checkMark: { color: MMD_WHITE, fontSize: 28, fontFamily: MMD_FONT.extrabold },
  successTitle: {
    color: MMD_WHITE,
    fontSize: 22,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    marginBottom: 8,
  },
  successAmount: {
    color: MMD_WHITE,
    fontSize: 40,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  successMeta: {
    color: "rgba(255,255,255,0.8)",
    marginTop: 8,
    fontFamily: MMD_FONT.regular,
  },
  balancePill: {
    marginTop: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  balancePillText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
  },
  filterBar: {
    flexDirection: "row",
    backgroundColor: MMD_GLASS,
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
  },
  filterTab: {
    flex: 1,
    height: 31,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  filterTabOn: { backgroundColor: "rgba(255,255,255,0.16)" },
  filterText: {
    color: "rgba(255,255,255,0.7)",
    fontFamily: MMD_FONT.semibold,
    fontSize: 13,
  },
  filterTextOn: { color: MMD_WHITE, fontFamily: MMD_FONT.bold },
  statsRow: { flexDirection: "row", gap: 12 },
  statCard: {
    flex: 1,
    backgroundColor: MMD_GLASS,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
    padding: 16,
  },
  statValue: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontSize: 18,
    marginTop: 6,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: MMD_GLASS,
    borderRadius: 16,
    padding: 16,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: MMD_WHITE, fontFamily: MMD_FONT.bold, fontSize: 16 },
  memberName: { color: MMD_WHITE, fontFamily: MMD_FONT.bold, fontSize: 15 },
  memberRole: { color: "#BFDBFE", fontFamily: MMD_FONT.regular, fontSize: 12, marginTop: 2 },
});
