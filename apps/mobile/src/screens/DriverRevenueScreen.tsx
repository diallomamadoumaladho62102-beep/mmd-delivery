import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";

type RangeKey = "week" | "today" | "month";

type OrderRow = {
  id: string;
  created_at: string | null;
  status: string | null;
  driver_id: string | null;
  driver_delivery_payout: number | null;
  delivery_fee: number | null;
  total: number | null;
  tip_cents?: number | null;
  kind: string | null;
  restaurant_name: string | null;
};

type QuickActionProps = {
  title: string;
  subtitle: string;
  icon: "activity" | "wallet" | "benefits";
  onPress: () => void;
};

const BG = "#020617";
const CARD = "rgba(15,23,42,0.86)";
const CARD_SOFT = "rgba(2,6,23,0.72)";
const BORDER = "rgba(148,163,184,0.14)";
const PURPLE = "#A78BFA";
const PURPLE_DARK = "#8B5CF6";
const BLUE = "#60A5FA";
const GREEN = "#22C55E";
const TEXT = "#F8FAFC";
const MUTED = "#94A3B8";
const DANGER = "#FCA5A5";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function startOfWeekMonday(d: Date) {
  const x = startOfDay(d);
  const day = x.getDay();
  const diff = day === 0 ? 6 : day - 1;
  x.setDate(x.getDate() - diff);
  return x;
}

function fmtMoney(n: number) {
  const x = Number(n);
  return `${(Number.isFinite(x) ? x : 0).toFixed(2)} $`;
}

function getGain(o: OrderRow) {
  const g = o.driver_delivery_payout ?? o.delivery_fee ?? o.total ?? 0;
  return Number.isFinite(Number(g)) ? Number(g) : 0;
}

function getTip(o: OrderRow) {
  const cents = Number(o?.tip_cents ?? 0);
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  return cents / 100;
}

function safeRouteNameLabel(routeName: string) {
  return routeName.replace(/([A-Z])/g, " $1").trim();
}

export function DriverRevenueScreen() {
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation();

  const [range, setRange] = useState<RangeKey>("week");
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [driverId, setDriverId] = useState<string | null>(null);

  const locale = useMemo(() => {
    const lng = (i18n.language || "en").toLowerCase();
    if (lng.startsWith("fr")) return "fr-FR";
    if (lng.startsWith("ar")) return "ar";
    if (lng.startsWith("es")) return "es-ES";
    if (lng.startsWith("zh")) return "zh-CN";
    return "en-US";
  }, [i18n.language]);

  const fmtShortDate = useCallback(
    (iso: string | null) => {
      if (!iso) return "—";
      const d = new Date(iso);
      return d.toLocaleDateString(locale, { day: "2-digit", month: "short" });
    },
    [locale],
  );

  const fmtTimeRange = useCallback(
    (iso: string | null) => {
      if (!iso) return "—";
      const d = new Date(iso);
      return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    },
    [locale],
  );

  const { fromISO, toISO, titleLabel } = useMemo(() => {
    const now = new Date();

    if (range === "today") {
      const from = startOfDay(now);
      const to = endOfDay(now);
      return {
        fromISO: from.toISOString(),
        toISO: to.toISOString(),
        titleLabel: t("driver.revenue.range.today", "Today"),
      };
    }

    if (range === "month") {
      const from = startOfMonth(now);
      const to = endOfDay(now);
      return {
        fromISO: from.toISOString(),
        toISO: to.toISOString(),
        titleLabel: t("driver.revenue.range.month", "Month"),
      };
    }

    const from = startOfWeekMonday(now);
    const to = endOfDay(now);
    const fromTxt = from.toLocaleDateString(locale, { day: "2-digit", month: "short" });
    const toTxt = now.toLocaleDateString(locale, { day: "2-digit", month: "short" });

    return {
      fromISO: from.toISOString(),
      toISO: to.toISOString(),
      titleLabel: `${fromTxt} - ${toTxt}`,
    };
  }, [range, t, locale]);

  const fetchRevenue = useCallback(async () => {
    try {
      setLoading(true);

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        setDriverId(null);
        setOrders([]);
        Alert.alert(
          t("driver.revenue.auth_title", "Login"),
          t("driver.revenue.auth_body", "Log in as a driver to see your earnings."),
        );
        return;
      }

      const uid = sessionData.session.user.id;
      setDriverId(uid);

      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, created_at, status, driver_id, driver_delivery_payout, delivery_fee, total, tip_cents, kind, restaurant_name",
        )
        .eq("driver_id", uid)
        .eq("status", "delivered")
        .gte("created_at", fromISO)
        .lte("created_at", toISO)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setOrders((data ?? []) as OrderRow[]);
    } catch (e: any) {
      console.log("fetchRevenue error:", e);
      Alert.alert(
        t("shared.orderChat.alerts.errorTitle", "Error"),
        e?.message ?? t("driver.revenue.load_error", "Unable to load earnings."),
      );
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [fromISO, toISO, t]);

  useFocusEffect(
    useCallback(() => {
      void fetchRevenue();
    }, [fetchRevenue]),
  );

  useEffect(() => {
    void fetchRevenue();
  }, [range, fetchRevenue]);

  const totals = useMemo(() => {
    const trips = orders.length;
    const baseEarnings = orders.reduce((sum, o) => sum + getGain(o), 0);
    const tips = orders.reduce((sum, o) => sum + getTip(o), 0);
    const totalEarnings = baseEarnings + tips;
    const points = trips;
    const averageTrip = trips > 0 ? totalEarnings / trips : 0;
    return { trips, baseEarnings, tips, totalEarnings, points, averageTrip };
  }, [orders]);

  const weekBars = useMemo(() => {
    const days = [
      t("driver.revenue.days.mon", "Mon"),
      t("driver.revenue.days.tue", "Tue"),
      t("driver.revenue.days.wed", "Wed"),
      t("driver.revenue.days.thu", "Thu"),
      t("driver.revenue.days.fri", "Fri"),
      t("driver.revenue.days.sat", "Sat"),
      t("driver.revenue.days.sun", "Sun"),
    ];

    const map: Record<string, number> = {};
    for (const d of days) map[d] = 0;

    for (const o of orders) {
      if (!o.created_at) continue;
      const d = new Date(o.created_at);
      const js = d.getDay();
      const idx = js === 0 ? 6 : js - 1;
      const key = days[idx];
      map[key] += getGain(o) + getTip(o);
    }

    const max = Math.max(1, ...Object.values(map));
    return days.map((label) => ({
      label,
      value: map[label],
      h: Math.max(10, Math.round((map[label] / max) * 70)),
    }));
  }, [orders, t]);

  const safeNavigate = useCallback(
    (routeName: string, params?: any) => {
      try {
        navigation.navigate(routeName, params);
      } catch (e) {
        Alert.alert(
          t("common.soon", "Coming soon ✅"),
          t("driver.revenue.not_added", `The page "${routeName}" is not yet added in AppNavigator.`, {
            route: safeRouteNameLabel(routeName),
          }),
        );
      }
    },
    [navigation, t],
  );

  const openDetails = useCallback(() => safeNavigate("DriverRevenueDetails", { range }), [safeNavigate, range]);
  const openWallet = useCallback(() => safeNavigate("DriverWallet"), [safeNavigate]);
  const openBenefits = useCallback(() => safeNavigate("DriverBenefits"), [safeNavigate]);
  const openHelp = useCallback(() => safeNavigate("DriverHelp"), [safeNavigate]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.root}>
        <View style={styles.headerWrap}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.roundButton} activeOpacity={0.85}>
              <Text style={styles.backIcon}>‹</Text>
            </TouchableOpacity>

            <Text style={styles.headerCenter}>{t("driver.revenue.header.title", "Earnings")}</Text>

            <TouchableOpacity onPress={openHelp} style={styles.helpButton} activeOpacity={0.85}>
              <Text style={styles.helpText}>{t("driver.revenue.help_btn", "Help")}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.title}>{t("driver.revenue.title", "Earnings")}</Text>
          <Text style={styles.subtitle}>{titleLabel}</Text>

          <View style={styles.tabsRow}>
            {[
              { k: "week" as const, label: t("driver.revenue.tabs.week", "Week") },
              { k: "today" as const, label: t("driver.revenue.tabs.today", "Today") },
              { k: "month" as const, label: t("driver.revenue.tabs.month", "Month") },
            ].map((tab) => {
              const active = range === tab.k;
              return (
                <TouchableOpacity
                  key={tab.k}
                  onPress={() => setRange(tab.k)}
                  style={[styles.tabPill, active && styles.tabPillActive]}
                  activeOpacity={0.86}
                >
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCard}>
            <View style={styles.heroTopRow}>
              <View style={styles.heroLeft}>
                <Text style={styles.mutedLabel}>{t("driver.revenue.total", "Total")}</Text>
                <Text style={styles.totalAmount} numberOfLines={1} adjustsFontSizeToFit>
                  {fmtMoney(totals.totalEarnings)}
                </Text>
                <Text style={styles.netLine} numberOfLines={2}>
                  {t("driver.revenue.net_price", "Net")}: {fmtMoney(totals.baseEarnings)} · {t("driver.revenue.tips", "Tips")}: {fmtMoney(totals.tips)}
                </Text>
              </View>

              <View style={styles.graphWrap}>
                {weekBars.map((b) => (
                  <View key={b.label} style={styles.barWrap}>
                    <View style={[styles.bar, { height: b.h }]} />
                    <Text style={styles.barLabel}>{b.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.metricsGrid}>
              <Metric label={t("driver.revenue.trips", "Trips")} value={String(totals.trips)} />
              <Metric label={t("driver.revenue.points", "Points")} value={String(totals.points)} />
              <Metric label={t("driver.revenue.average", "Avg / trip")} value={fmtMoney(totals.averageTrip)} />
            </View>

            <TouchableOpacity onPress={openDetails} style={styles.primaryButton} activeOpacity={0.86}>
              <Text style={styles.primaryButtonText}>{t("driver.revenue.show_details", "Show details")}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.quickGrid}>
            <QuickAction
              icon="activity"
              title={t("driver.revenue.activity", "Activity")}
              subtitle={t("driver.revenue.activity_hint", "Time & trips")}
              onPress={openDetails}
            />
            <QuickAction
              icon="wallet"
              title={t("driver.revenue.wallet", "Wallet")}
              subtitle={t("driver.revenue.wallet_hint", "Balance & payouts")}
              onPress={openWallet}
            />
            <QuickAction
              icon="benefits"
              title={t("driver.revenue.benefits", "Benefits")}
              subtitle={t("driver.revenue.benefits_hint", "Bonuses & boosts")}
              onPress={openBenefits}
            />
          </View>

          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>{t("driver.revenue.recent_sessions", "Recent sessions")}</Text>
            <TouchableOpacity onPress={() => void fetchRevenue()} disabled={loading} style={styles.refreshPill} activeOpacity={0.85}>
              {loading ? <ActivityIndicator color={PURPLE} size="small" /> : <Text style={styles.refreshText}>{t("shared.common.refresh", "Refresh")}</Text>}
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.loadingText}>{t("shared.common.loading", "Loading…")}</Text>
            </View>
          ) : orders.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{t("driver.revenue.no_trips", "No delivered trips in this period.")}</Text>
              <Text style={styles.emptySub}>{t("driver.revenue.no_trips_hint", "Completed deliveries will appear here after they are delivered.")}</Text>
            </View>
          ) : (
            <View style={styles.sessionsList}>
              {orders.slice(0, 12).map((o) => {
                const base = getGain(o);
                const tip = getTip(o);
                const total = base + tip;

                return (
                  <TouchableOpacity
                    key={o.id}
                    onPress={() =>
                      Alert.alert(
                        t("driver.revenue.trip_title", "Trip"),
                        `${t("driver.revenue.trip_id", "ID")}: ${o.id}\n${t("driver.revenue.net_price", "Net")}: ${fmtMoney(base)}\n${t("driver.revenue.tip", "Tip")}: ${fmtMoney(tip)}\n${t("driver.revenue.total", "Total")}: ${fmtMoney(total)}`,
                      )
                    }
                    style={styles.sessionCard}
                    activeOpacity={0.86}
                  >
                    <View style={styles.sessionTopRow}>
                      <View style={{ flex: 1, paddingRight: 10 }}>
                        <Text style={styles.sessionAmount}>{fmtMoney(total)}</Text>
                        <Text style={styles.sessionMeta} numberOfLines={1}>
                          {fmtTimeRange(o.created_at)} · #{o.id.slice(0, 8)}{o.restaurant_name ? ` · ${o.restaurant_name}` : ""}
                        </Text>
                      </View>
                      <View style={styles.datePill}>
                        <Text style={styles.datePillText}>{fmtShortDate(o.created_at)}</Text>
                      </View>
                    </View>

                    <View style={styles.sessionBreakdown}>
                      <Text style={styles.breakdownText}>{t("driver.revenue.net_price", "Net")}: {fmtMoney(base)}</Text>
                      <Text style={styles.breakdownText}>{t("driver.revenue.tip", "Tip")}: {fmtMoney(tip)}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {driverId ? (
            <Text style={styles.driverDebug}>{t("driver.revenue.driver_label", "Driver")}: {driverId.slice(0, 8)}…</Text>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function QuickAction({ title, subtitle, icon, onPress }: QuickActionProps) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.quickCard} activeOpacity={0.86}>
      <View style={styles.quickIconBox}>
        <RevenueIcon name={icon} />
      </View>
      <Text style={styles.quickTitle} numberOfLines={1}>{title}</Text>
      <Text style={styles.quickSub} numberOfLines={2}>{subtitle}</Text>
    </TouchableOpacity>
  );
}

function RevenueIcon({ name }: { name: QuickActionProps["icon"] }) {
  if (name === "wallet") {
    return (
      <View style={styles.walletIcon}>
        <View style={styles.walletBody} />
        <View style={styles.walletDot} />
      </View>
    );
  }

  if (name === "benefits") {
    return <Text style={styles.iconGlyph}>★</Text>;
  }

  return (
    <View style={styles.activityIcon}>
      <View style={[styles.activityBar, { height: 12 }]} />
      <View style={[styles.activityBar, { height: 19 }]} />
      <View style={[styles.activityBar, { height: 8 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  root: { flex: 1, backgroundColor: BG },
  headerWrap: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 4 },
  headerRow: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  roundButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: CARD_SOFT, borderWidth: 1, borderColor: BORDER, alignItems: "center", justifyContent: "center" },
  backIcon: { color: "#BFDBFE", fontSize: 34, fontWeight: "700", marginTop: -2 },
  headerCenter: { color: TEXT, fontSize: 16, fontWeight: "900" },
  helpButton: { minWidth: 66, height: 42, borderRadius: 999, paddingHorizontal: 14, backgroundColor: CARD_SOFT, borderWidth: 1, borderColor: BORDER, alignItems: "center", justifyContent: "center" },
  helpText: { color: "#E5E7EB", fontWeight: "900" },
  title: { color: TEXT, fontSize: 36, fontWeight: "900", marginTop: 10, letterSpacing: -0.8 },
  subtitle: { color: MUTED, marginTop: 4, fontSize: 13, fontWeight: "800" },
  tabsRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  tabPill: { paddingVertical: 9, paddingHorizontal: 15, borderRadius: 999, backgroundColor: CARD_SOFT, borderWidth: 1, borderColor: BORDER },
  tabPillActive: { backgroundColor: "rgba(139,92,246,0.18)", borderColor: "rgba(167,139,250,0.65)" },
  tabText: { color: "#E5E7EB", fontWeight: "900" },
  tabTextActive: { color: PURPLE },
  content: { padding: 18, paddingBottom: 34 },
  heroCard: { borderRadius: 30, padding: 18, backgroundColor: CARD, borderWidth: 1, borderColor: "rgba(167,139,250,0.20)", shadowColor: PURPLE_DARK, shadowOpacity: 0.18, shadowRadius: 26, shadowOffset: { width: 0, height: 12 }, elevation: 10, overflow: "hidden" },
  heroTopRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  heroLeft: { flex: 1, paddingRight: 14 },
  mutedLabel: { color: MUTED, fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.5 },
  totalAmount: { color: TEXT, fontSize: 44, fontWeight: "900", marginTop: 4, letterSpacing: -1.2 },
  netLine: { color: MUTED, marginTop: 7, fontWeight: "800", lineHeight: 18 },
  graphWrap: { minWidth: 105, flexDirection: "row", alignItems: "flex-end", gap: 6, paddingBottom: 2 },
  barWrap: { alignItems: "center" },
  bar: { width: 10, borderRadius: 999, backgroundColor: PURPLE },
  barLabel: { color: MUTED, fontSize: 9, marginTop: 6, fontWeight: "800" },
  divider: { height: 1, backgroundColor: BORDER, marginVertical: 16 },
  metricsGrid: { flexDirection: "row", gap: 10 },
  metricCard: { flex: 1, minHeight: 70, borderRadius: 20, padding: 12, backgroundColor: "rgba(2,6,23,0.52)", borderWidth: 1, borderColor: BORDER, justifyContent: "center" },
  metricValue: { color: TEXT, fontSize: 19, fontWeight: "900" },
  metricLabel: { color: MUTED, fontSize: 11, fontWeight: "800", marginTop: 4 },
  primaryButton: { marginTop: 16, height: 54, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(139,92,246,0.18)", borderWidth: 1, borderColor: "rgba(167,139,250,0.54)" },
  primaryButtonText: { color: "#DDD6FE", fontWeight: "900", fontSize: 15 },
  quickGrid: { flexDirection: "row", gap: 10, marginTop: 14 },
  quickCard: { flex: 1, minHeight: 110, borderRadius: 24, padding: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, justifyContent: "space-between" },
  quickIconBox: { width: 38, height: 38, borderRadius: 14, backgroundColor: "rgba(139,92,246,0.14)", alignItems: "center", justifyContent: "center" },
  quickTitle: { color: TEXT, fontSize: 13, fontWeight: "900", marginTop: 8 },
  quickSub: { color: MUTED, fontSize: 11, fontWeight: "700", marginTop: 3, lineHeight: 15 },
  sectionHeaderRow: { marginTop: 20, marginBottom: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { color: TEXT, fontSize: 22, fontWeight: "900" },
  refreshPill: { minWidth: 76, height: 36, borderRadius: 999, paddingHorizontal: 12, backgroundColor: CARD_SOFT, borderWidth: 1, borderColor: BORDER, alignItems: "center", justifyContent: "center" },
  refreshText: { color: PURPLE, fontWeight: "900", fontSize: 12 },
  loadingRow: { marginTop: 6, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 18, padding: 14 },
  loadingText: { color: MUTED, fontWeight: "800" },
  emptyCard: { borderRadius: 22, padding: 16, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  emptyTitle: { color: TEXT, fontSize: 15, fontWeight: "900" },
  emptySub: { color: MUTED, marginTop: 6, fontWeight: "700", lineHeight: 18 },
  sessionsList: { gap: 10 },
  sessionCard: { borderRadius: 22, padding: 15, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  sessionTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  sessionAmount: { color: TEXT, fontSize: 22, fontWeight: "900" },
  sessionMeta: { color: MUTED, marginTop: 7, fontWeight: "800" },
  datePill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "rgba(96,165,250,0.12)", borderWidth: 1, borderColor: "rgba(96,165,250,0.28)" },
  datePillText: { color: "#BFDBFE", fontSize: 11, fontWeight: "900" },
  sessionBreakdown: { flexDirection: "row", gap: 10, marginTop: 11, flexWrap: "wrap" },
  breakdownText: { color: "#CBD5E1", fontSize: 12, fontWeight: "800" },
  driverDebug: { color: "#334155", marginTop: 18, fontSize: 11 },
  walletIcon: { width: 24, height: 18, justifyContent: "center" },
  walletBody: { position: "absolute", width: 24, height: 18, borderRadius: 5, borderWidth: 2, borderColor: PURPLE },
  walletDot: { position: "absolute", right: 4, width: 6, height: 6, borderRadius: 3, backgroundColor: PURPLE },
  activityIcon: { width: 25, height: 25, flexDirection: "row", alignItems: "flex-end", gap: 4 },
  activityBar: { width: 5, borderRadius: 999, backgroundColor: PURPLE },
  iconGlyph: { color: PURPLE, fontSize: 22, fontWeight: "900", marginTop: -2 },
});
