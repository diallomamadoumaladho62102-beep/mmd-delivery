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
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { applyLiveTripFilters } from "../lib/tripVisibility";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { DriverBrandLoadingState } from "../components/driver/DriverBrandLoadingState";
import {
  MMD_ACTION_NAVY,
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_MUTED,
  MMD_TEXT,
  MMD_WHITE,
} from "../theme/mmdUi";

const MMD_LOGO = require("../../assets/brand/mmd-logo-ui.png");

type RangeKey = "week" | "today" | "month";

type SourceTable = "orders" | "delivery_requests";

type OrderRow = {
  id: string;
  created_at: string | null;
  status: string | null;
  driver_id: string | null;

  driver_delivery_payout: number | null;

  // ✅ tip depuis DB (cents). delivery_requests do not use tips here.
  tip_cents?: number | null;

  kind: string | null;
  restaurant_name: string | null;
  source_table: SourceTable;
};

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
  const day = x.getDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1; // Monday=0
  x.setDate(x.getDate() - diff);
  return x;
}

function fmtMoney(n: number) {
  const x = Number(n);
  return `${(Number.isFinite(x) ? x : 0).toFixed(2)} $`;
}

function fmtShortDate(iso: string | null, locale: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(locale || "en-US", { day: "2-digit", month: "short" });
}

function fmtTime(iso: string | null, locale: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString(locale || "en-US", { hour: "2-digit", minute: "2-digit" });
}

function toSafeNumber(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getGain(o: OrderRow) {
  // Production privacy rule:
  // Driver revenue must be based only on the driver's payout.
  // Never fall back to delivery_fee or total because those are customer-facing amounts.
  return toSafeNumber(o.driver_delivery_payout);
}

// ✅ tip en dollars (depuis tip_cents)
function getTip(o: OrderRow) {
  const cents = Number(o?.tip_cents ?? 0);
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  return cents / 100;
}

// ✅ Afficher secondes
function fmtDurationFromSeconds(secs: number) {
  const s = Math.max(0, Math.floor(secs || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${h} h ${String(m).padStart(2, "0")} m ${String(ss).padStart(2, "0")} s`;
}

/** Stable pastel-ish hex from order id (color pills in Figma). */
function hashColorFromId(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const r = 96 + (h & 0x7f);
  const g = 96 + ((h >>> 8) & 0x7f);
  const b = 96 + ((h >>> 16) & 0x7f);
  const hex = (n: number) => Math.min(255, n).toString(16).padStart(2, "0").toUpperCase();
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// ✅ RPC renvoie des SECONDES
type DriverStatsRow = {
  online_seconds: number | null;
  driving_seconds: number | null;
  trips?: number | null;
  points?: number | null;
};

function BrandFooter() {
  return (
    <View style={styles.footer}>
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

export function DriverRevenueDetailsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { t, i18n } = useTranslation();

  const range: RangeKey = (route?.params?.range as RangeKey) ?? "week";

  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [driverId, setDriverId] = useState<string | null>(null);

  const [statsSeconds, setStatsSeconds] = useState<{
    onlineSeconds: number;
    drivingSeconds: number;
  }>({ onlineSeconds: 0, drivingSeconds: 0 });

  const localeForDates = useMemo(() => {
    // Mapping simple pour Intl/Date: i18n.language -> locale
    const lng = String(i18n.language || "en").toLowerCase();
    if (lng.startsWith("fr")) return "fr-FR";
    if (lng.startsWith("es")) return "es-ES";
    if (lng.startsWith("ar")) return "ar";
    if (lng.startsWith("zh")) return "zh-CN";
    if (lng.startsWith("ff")) return "fr-FR"; // fallback raisonnable si pas de locale Intl dédiée
    return "en-US";
  }, [i18n.language]);

  const { fromISO, toISO, titleLabel, daysLabel } = useMemo(() => {
    const now = new Date();

    if (range === "today") {
      const from = startOfDay(now);
      const to = endOfDay(now);
      return {
        fromISO: from.toISOString(),
        toISO: to.toISOString(),
        titleLabel: t("driver.revenue.details.title", "Details"),
        daysLabel: t("driver.revenue.details.range.today", "Today"),
      };
    }

    if (range === "month") {
      const from = startOfMonth(now);
      const to = endOfDay(now);
      const fromTxt = from.toLocaleDateString(localeForDates, { day: "2-digit", month: "short" });
      const toTxt = now.toLocaleDateString(localeForDates, { day: "2-digit", month: "short" });
      return {
        fromISO: from.toISOString(),
        toISO: to.toISOString(),
        titleLabel: t("driver.revenue.details.title", "Details"),
        daysLabel: `${fromTxt} - ${toTxt}`,
      };
    }

    // week
    const from = startOfWeekMonday(now);
    const to = endOfDay(now);
    const fromTxt = from.toLocaleDateString(localeForDates, { day: "2-digit", month: "short" });
    const toTxt = now.toLocaleDateString(localeForDates, { day: "2-digit", month: "short" });
    return {
      fromISO: from.toISOString(),
      toISO: to.toISOString(),
      titleLabel: t("driver.revenue.details.title", "Details"),
      daysLabel: `${fromTxt} - ${toTxt}`,
    };
  }, [range, t, localeForDates]);

  const fetchDetails = useCallback(
    async (aliveRef: { alive: boolean }) => {
      try {
        setLoading(true);

        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          if (!aliveRef.alive) return;
          setDriverId(null);
          setOrders([]);
          setStatsSeconds({ onlineSeconds: 0, drivingSeconds: 0 });
          Alert.alert(
            t("driver.revenue.details.auth.title", "Login"),
            t(
              "driver.revenue.details.auth.body",
              "Log in as a driver to view your earnings."
            )
          );
          return;
        }

        const uid = sessionData.session.user.id;
        if (!aliveRef.alive) return;
        setDriverId(uid);

        const { data: orderRows, error: ordersError } = await applyLiveTripFilters(
          supabase
            .from("orders")
            .select(
              "id, created_at, status, driver_id, driver_delivery_payout, tip_cents, kind, restaurant_name"
            ),
        )
          .eq("driver_id", uid)
          .eq("status", "delivered")
          .gte("created_at", fromISO)
          .lte("created_at", toISO)
          .order("created_at", { ascending: false });

        if (ordersError) throw ordersError;

        const { data: deliveryRequestRows, error: deliveryRequestsError } = await applyLiveTripFilters(
          supabase
            .from("delivery_requests")
            .select("id, created_at, status, driver_id, driver_delivery_payout, kind"),
        )
          .eq("driver_id", uid)
          .eq("status", "delivered")
          .gte("created_at", fromISO)
          .lte("created_at", toISO)
          .order("created_at", { ascending: false });

        if (deliveryRequestsError) throw deliveryRequestsError;

        const normalizedOrders: OrderRow[] = ((orderRows ?? []) as any[]).map((row) => ({
          id: String(row.id),
          created_at: row.created_at ?? null,
          status: row.status ?? null,
          driver_id: row.driver_id ?? null,
          driver_delivery_payout:
            Number.isFinite(Number(row.driver_delivery_payout))
              ? Number(row.driver_delivery_payout)
              : null,
          tip_cents:
            Number.isFinite(Number(row.tip_cents))
              ? Number(row.tip_cents)
              : 0,
          kind: row.kind ?? null,
          restaurant_name: row.restaurant_name ?? null,
          source_table: "orders",
        }));

        const normalizedDeliveryRequests: OrderRow[] = ((deliveryRequestRows ?? []) as any[]).map((row) => ({
          id: String(row.id),
          created_at: row.created_at ?? null,
          status: row.status ?? null,
          driver_id: row.driver_id ?? null,
          driver_delivery_payout:
            Number.isFinite(Number(row.driver_delivery_payout))
              ? Number(row.driver_delivery_payout)
              : null,
          tip_cents: 0,
          kind: row.kind ?? "delivery",
          restaurant_name: null,
          source_table: "delivery_requests",
        }));

        const mergedRows = [...normalizedOrders, ...normalizedDeliveryRequests].sort(
          (a, b) =>
            new Date(b.created_at ?? 0).getTime() -
            new Date(a.created_at ?? 0).getTime()
        );

        if (!aliveRef.alive) return;
        setOrders(mergedRows);
      } catch (e: any) {
        console.log("fetchDetails error:", e);
        if (!aliveRef.alive) return;
        Alert.alert(
          t("common.errorTitle", "Error"),
          e?.message ?? t("driver.revenue.details.loadError", "Unable to load details.")
        );
        setOrders([]);
      } finally {
        if (!aliveRef.alive) return;
        setLoading(false);
        setInitialLoad(false);
      }
    },
    [fromISO, toISO, t]
  );

  const fetchStats = useCallback(
    async (aliveRef: { alive: boolean }) => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          if (!aliveRef.alive) return;
          setStatsSeconds({ onlineSeconds: 0, drivingSeconds: 0 });
          return;
        }

        const { data, error } = await supabase.rpc("get_driver_stats", {
          from_ts: fromISO,
          to_ts: toISO,
        });

        if (error) {
          console.log("❌ get_driver_stats error:", error);
          if (!aliveRef.alive) return;
          setStatsSeconds({ onlineSeconds: 0, drivingSeconds: 0 });
          return;
        }

        const row: DriverStatsRow | null = Array.isArray(data)
          ? (data[0] as DriverStatsRow | undefined) ?? null
          : (data as DriverStatsRow | null);

        const onlineSecs = Number(row?.online_seconds ?? 0);
        const drivingSecs = Number(row?.driving_seconds ?? 0);

        if (!aliveRef.alive) return;
        setStatsSeconds({
          onlineSeconds: Number.isFinite(onlineSecs) ? onlineSecs : 0,
          drivingSeconds: Number.isFinite(drivingSecs) ? drivingSecs : 0,
        });
      } catch (e: any) {
        console.log("fetchStats error:", e);
        if (!aliveRef.alive) return;
        setStatsSeconds({ onlineSeconds: 0, drivingSeconds: 0 });
      }
    },
    [fromISO, toISO]
  );

  useFocusEffect(
    useCallback(() => {
      const aliveRef = { alive: true };

      void fetchDetails(aliveRef);
      void fetchStats(aliveRef);

      return () => {
        aliveRef.alive = false;
      };
    }, [fetchDetails, fetchStats])
  );

  // ✅ Calculs propres
  const totals = useMemo(() => {
    const trips = orders.length;
    const baseEarnings = orders.reduce((sum, o) => sum + getGain(o), 0);
    const tips = orders.reduce((sum, o) => sum + getTip(o), 0);
    const totalEarnings = baseEarnings + tips;
    const points = trips;
    return { trips, baseEarnings, tips, totalEarnings, points };
  }, [orders]);

  const weekDayLabels = useMemo(
    () => [
      t("driver.revenue.details.week.mon", "Mon"),
      t("driver.revenue.details.week.tue", "Tue"),
      t("driver.revenue.details.week.wed", "Wed"),
      t("driver.revenue.details.week.thu", "Thu"),
      t("driver.revenue.details.week.fri", "Fri"),
      t("driver.revenue.details.week.sat", "Sat"),
      t("driver.revenue.details.week.sun", "Sun"),
    ],
    [t],
  );

  // ✅ Bars: week => Mon..Sun, sinon => last 7 days
  const bars = useMemo(() => {
    if (range === "week") {
      const days = weekDayLabels;
      const map: Record<string, number> = {};
      for (const d of days) map[d] = 0;

      for (const o of orders) {
        if (!o.created_at) continue;
        const d = new Date(o.created_at);
        const js = d.getDay(); // 0 Sun
        const idx = js === 0 ? 6 : js - 1;
        const key = days[idx];
        map[key] += getGain(o);
      }

      const max = Math.max(1, ...Object.values(map));
      return days.map((label) => ({
        label,
        value: map[label],
        h: Math.max(4, Math.round((map[label] / max) * 100)),
      }));
    }

    // last 7 days bars
    const end = new Date(toISO);
    const days: { key: string; label: string; start: Date; end: Date }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(d.getDate() - i);
      const s = startOfDay(d);
      const e = endOfDay(d);
      const label = d.toLocaleDateString(localeForDates, { day: "2-digit", month: "short" });
      days.push({ key: `${s.toISOString()}`, label, start: s, end: e });
    }

    const map: Record<string, number> = {};
    for (const d of days) map[d.key] = 0;

    for (const o of orders) {
      if (!o.created_at) continue;
      const tt = new Date(o.created_at).getTime();
      for (const d of days) {
        if (tt >= d.start.getTime() && tt <= d.end.getTime()) {
          map[d.key] += getGain(o);
          break;
        }
      }
    }

    const max = Math.max(1, ...Object.values(map));
    return days.map((d) => ({
      label: d.label,
      value: map[d.key],
      h: Math.max(4, Math.round((map[d.key] / max) * 100)),
    }));
  }, [orders, range, toISO, weekDayLabels, localeForDates]);

  const stats = useMemo(() => {
    return {
      online: fmtDurationFromSeconds(statsSeconds.onlineSeconds),
      driving: fmtDurationFromSeconds(statsSeconds.drivingSeconds),
    };
  }, [statsSeconds]);

  const openLastPriceDetails = useCallback(() => {
    if (!orders || orders.length === 0) {
      Alert.alert(
        t("common.infoTitle", "Info"),
        t("driver.revenue.details.noTripToShow", "No trip available to show details.")
      );
      return;
    }
    const last = orders[0];
    navigation.navigate("DriverOrderDetails", { orderId: last.id, sourceTable: last.source_table });
  }, [navigation, orders, t]);

  const onRefresh = useCallback(() => {
    const aliveRef = { alive: true };
    void fetchDetails(aliveRef);
    void fetchStats(aliveRef);
  }, [fetchDetails, fetchStats]);

  const showEmpty = !loading && orders.length === 0;
  const showPopulated = !loading && orders.length > 0;

  if (initialLoad && loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
        <ScreenHeader
          title={titleLabel}
          subtitle={daysLabel}
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
          title={titleLabel}
          subtitle={daysLabel}
          fallbackRoute="DriverTabs"
          variant="mmd"
          rightSlot={
            <TouchableOpacity
              onPress={onRefresh}
              disabled={loading}
              style={[styles.refreshButton, loading && styles.refreshDisabled]}
              activeOpacity={0.85}
            >
              <Text style={styles.refreshText}>
                {loading
                  ? t("shared.common.loadingEllipsis", "…")
                  : t("common.refresh", "Refresh")}
              </Text>
            </TouchableOpacity>
          }
        />

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <View style={styles.loadingCard}>
              <Text style={styles.loadingLabel}>
                {t("driver.revenue.details.earnings", "Earnings")}
              </Text>
              <View style={styles.loadingFeedback}>
                <ActivityIndicator color={MMD_WHITE} />
                <Text style={styles.loadingText}>
                  {t("common.loading", "Loading…")}
                </Text>
              </View>
            </View>
          ) : null}

          {showEmpty ? (
            <>
              <View style={styles.earningsCard}>
                <Text style={styles.earningsTitle}>
                  📊 {t("driver.revenue.details.earnings", "Earnings")}
                </Text>
                <View style={styles.emptyChart}>
                  {weekDayLabels.map((label) => (
                    <View key={label} style={styles.barCol}>
                      <View style={styles.emptyBar} />
                      <Text style={styles.barLabel}>{label}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.tripsMeta}>
                  {t("driver.revenue.details.tripsLabel", "Trips")}: 0
                </Text>
              </View>

              <View style={styles.statsRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>
                    {t("driver.revenue.details.stats.online", "Online")}
                  </Text>
                  <Text style={styles.statValue}>{stats.online}</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>
                    {t("driver.revenue.details.stats.driving", "Driving")}
                  </Text>
                  <Text style={styles.statValue}>{stats.driving}</Text>
                </View>
              </View>

              <View style={styles.emptyTripsCard}>
                <Text style={styles.emptyEmoji}>📭</Text>
                <Text style={styles.emptyTitle}>
                  {t("driver.revenue.details.completed.emptyShort", "No trips")}
                </Text>
                <Text style={styles.emptyBody}>
                  {t(
                    "driver.revenue.details.completed.empty",
                    "No delivered trip in this period.",
                  )}
                </Text>
              </View>

              <BrandFooter />
            </>
          ) : null}

          {showPopulated ? (
            <>
              <View style={styles.earningsCard}>
                <Text style={styles.earningsTitle}>
                  📊 {t("driver.revenue.details.earnings", "Earnings")}
                </Text>
                <View style={styles.chart}>
                  {bars.map((b) => (
                    <View key={b.label} style={styles.barCol}>
                      <View style={[styles.bar, { height: b.h }]} />
                      <Text style={styles.barLabel}>{b.label}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.tripsMeta}>
                  {t("driver.revenue.details.tripsLabel", "Trips")}: {totals.trips}
                </Text>
              </View>

              <View style={styles.statsRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>
                    {t("driver.revenue.details.stats.online", "Online")}
                  </Text>
                  <Text style={styles.statValue}>{stats.online}</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>
                    {t("driver.revenue.details.stats.driving", "Driving")}
                  </Text>
                  <Text style={styles.statValue}>{stats.driving}</Text>
                </View>
              </View>

              <TouchableOpacity
                onPress={() =>
                  Alert.alert(
                    t("driver.revenue.details.calc.title", "Calculation"),
                    t(
                      "driver.revenue.details.calc.body",
                      "Online/Driving come from RPC get_driver_stats(from_ts,to_ts). Trips = delivered. Points = number of trips.",
                    ),
                  )
                }
                style={styles.calcLinkWrap}
                activeOpacity={0.85}
              >
                <Text style={styles.calcLink}>
                  {t("driver.revenue.details.calc.link", "How we calculate stats")}
                </Text>
              </TouchableOpacity>

              <View style={styles.breakdownCard}>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>
                    💰 {t("driver.revenue.details.breakdown.netPrice", "Net price")}
                  </Text>
                  <Text style={styles.breakdownValue}>
                    {fmtMoney(totals.baseEarnings)}
                  </Text>
                </View>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>
                    💵 {t("driver.revenue.details.breakdown.tip", "Tip")}
                  </Text>
                  <Text style={styles.breakdownValue}>{fmtMoney(totals.tips)}</Text>
                </View>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownTotalLabel}>
                    {t("driver.revenue.details.breakdown.total", "Total earnings")}
                  </Text>
                  <Text style={styles.breakdownTotalValue}>
                    {fmtMoney(totals.totalEarnings)}
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={openLastPriceDetails}
                  style={styles.ghostButton}
                  activeOpacity={0.85}
                >
                  <Text style={styles.ghostButtonText}>
                    {t(
                      "driver.revenue.details.breakdown.viewLastTripPrice",
                      "View trip price details",
                    )}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => navigation.navigate("DriverRevenueHistory", { range })}
                  style={styles.ghostButton}
                  activeOpacity={0.85}
                >
                  <Text style={styles.ghostButtonText}>
                    {t(
                      "driver.revenue.details.breakdown.viewHistory",
                      "View earnings history",
                    )}
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.sectionTitle}>
                {t("driver.revenue.details.completed.title", "Completed trips")}
              </Text>

              <View style={styles.tripList}>
                {orders.slice(0, 30).map((o) => {
                  const gain = getGain(o);
                  const tip = getTip(o);
                  const pill = hashColorFromId(o.id);
                  const restaurant =
                    o.source_table === "delivery_requests"
                      ? "Delivery"
                      : o.restaurant_name ?? "—";

                  return (
                    <TouchableOpacity
                      key={`${o.source_table}:${o.id}`}
                      onPress={() =>
                        Alert.alert(
                          t("driver.revenue.details.tripAlert.title", "Trip"),
                          t(
                            "driver.revenue.details.shareText",
                            "ID: {{id}}\nDate: {{date}} {{time}}\nNet price: {{net}}\nTip: {{tip}}\nTotal: {{total}}\nRestaurant: {{restaurant}}",
                            {
                              id: o.id,
                              date: fmtShortDate(o.created_at, localeForDates),
                              time: fmtTime(o.created_at, localeForDates),
                              net: fmtMoney(gain),
                              tip: fmtMoney(tip),
                              total: fmtMoney(gain + tip),
                              restaurant,
                            },
                          ),
                        )
                      }
                      style={styles.tripCard}
                      activeOpacity={0.86}
                    >
                      <View style={styles.tripTopRow}>
                        <View style={styles.tripAmountRow}>
                          <Text style={styles.tripAmount}>
                            {fmtMoney(gain + tip)}
                          </Text>
                          <View style={[styles.colorPill, { backgroundColor: pill }]}>
                            <Text style={styles.colorPillText}>{pill}</Text>
                          </View>
                        </View>
                        <View style={[styles.datePill, { backgroundColor: pill }]}>
                          <Text style={styles.datePillText}>
                            {fmtShortDate(o.created_at, localeForDates)}
                          </Text>
                        </View>
                      </View>

                      <Text style={styles.restaurantName}>{restaurant}</Text>
                      <Text style={styles.tripMeta}>
                        {fmtTime(o.created_at, localeForDates)} · #{o.id.slice(0, 8)}
                      </Text>

                      <View style={styles.tripBreakdownRow}>
                        <Text style={styles.tripBreakdownText}>
                          {t(
                            "driver.revenue.details.list.netTipLine",
                            "Net price: {{net}} · Tip: {{tip}}",
                            {
                              net: fmtMoney(gain),
                              tip: fmtMoney(tip),
                            },
                          )}
                        </Text>
                        <Text style={styles.chevron}>›</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {driverId ? (
                <Text style={styles.driverIdHint}>
                  {t("driver.revenue.details.driverId", "Driver")} :{" "}
                  {driverId.slice(0, 8)}…
                </Text>
              ) : null}

              <BrandFooter />
            </>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const BORDER = "rgba(148,163,184,0.18)";
const MUTED_SOFT = "rgba(255,255,255,0.7)";
const BAR_BLUE = "rgba(59,130,246,0.95)";

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  root: { flex: 1, backgroundColor: MMD_BLUE },
  refreshButton: {
    minWidth: 82,
    height: 42,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  refreshDisabled: { opacity: 0.65 },
  refreshText: {
    color: MMD_TEXT,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 12,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 30,
    gap: 16,
  },
  loadingCard: {
    borderRadius: 18,
    backgroundColor: "rgba(0,51,204,0.65)",
    borderWidth: 1,
    borderColor: MMD_ACTION_NAVY,
    padding: 16,
    gap: 10,
  },
  loadingLabel: {
    color: MMD_MUTED,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 13,
  },
  loadingFeedback: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 20,
  },
  loadingText: {
    color: MMD_TEXT,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 20,
    textAlign: "center",
  },
  earningsCard: {
    borderRadius: 14,
    backgroundColor: MMD_ACTION_NAVY,
    padding: 16,
    gap: 12,
  },
  earningsTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 16,
  },
  emptyChart: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    height: 80,
  },
  chart: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    height: 120,
  },
  barCol: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    height: "100%",
  },
  emptyBar: {
    width: "100%",
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  bar: {
    width: 18,
    borderRadius: 10,
    backgroundColor: BAR_BLUE,
  },
  barLabel: {
    color: MUTED_SOFT,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 11,
  },
  tripsMeta: {
    color: MUTED_SOFT,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 13,
  },
  statsRow: { flexDirection: "row", gap: 12 },
  statCard: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: MMD_ACTION_NAVY,
    padding: 14,
    gap: 6,
  },
  statLabel: {
    color: MUTED_SOFT,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 12,
  },
  statValue: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 18,
  },
  calcLinkWrap: { alignItems: "center" },
  calcLink: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 13,
    textDecorationLine: "underline",
  },
  breakdownCard: {
    borderRadius: 14,
    backgroundColor: MMD_ACTION_NAVY,
    padding: 16,
    gap: 12,
  },
  breakdownRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  breakdownLabel: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 14,
  },
  breakdownValue: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
  },
  breakdownTotalLabel: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
  },
  breakdownTotalValue: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
  },
  ghostButton: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  ghostButtonText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 14,
  },
  sectionTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 18,
  },
  emptyTripsCard: {
    borderRadius: 14,
    backgroundColor: MMD_ACTION_NAVY,
    padding: 16,
    alignItems: "center",
    gap: 8,
  },
  emptyEmoji: {
    fontSize: 14,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  emptyTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 18,
    textAlign: "center",
  },
  emptyBody: {
    color: MUTED_SOFT,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 13,
    textAlign: "center",
  },
  tripList: { gap: 12 },
  tripCard: {
    borderRadius: 12,
    backgroundColor: MMD_ACTION_NAVY,
    padding: 16,
    gap: 12,
  },
  tripTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  tripAmountRow: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  tripAmount: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 20,
  },
  colorPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  colorPillText: {
    color: MMD_BLUE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 10,
  },
  datePill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  datePillText: {
    color: MMD_BLUE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 11,
  },
  restaurantName: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 14,
  },
  tripMeta: {
    color: MUTED_SOFT,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 12,
  },
  tripBreakdownRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  tripBreakdownText: {
    color: MUTED_SOFT,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 12,
    flex: 1,
  },
  chevron: {
    color: MUTED_SOFT,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 24,
  },
  driverIdHint: {
    color: "rgba(255,255,255,0.35)",
    fontFamily: MMD_FONT.regular,
    fontSize: 11,
  },
  footer: {
    alignItems: "center",
    gap: 12,
    paddingTop: 8,
  },
  footerLogo: { width: 44, height: 44, borderRadius: 10 },
  footerBrand: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
  },
});
