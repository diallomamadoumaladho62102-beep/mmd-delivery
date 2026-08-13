import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { useNavigation, useRoute } from "@react-navigation/native";
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
  MMD_TAXI_GREEN,
  MMD_TEXT,
  MMD_WHITE,
} from "../theme/mmdUi";

const MMD_LOGO = require("../../assets/brand/mmd-logo-ui.png");

const LILAC = "#A78BFA";
const LILAC_SOFT = "#DDD6FE";
const TRIP_EMOJIS = ["🟢", "🔵", "🟣", "🟡", "🟠", "🔴", "⚪"] as const;

type RangeKey = "today" | "week" | "month";

type SourceTable = "orders" | "delivery_requests";

type OrderRow = {
  id: string;
  created_at: string | null;
  status: string | null;
  driver_id: string | null;

  driver_delivery_payout: number | null;

  // ✅ tip (en cents). delivery_requests do not use tips here.
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

function fmtTime(iso: string | null, locale: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString(locale || "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
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

// ✅ A2: tip en dollars depuis tip_cents
function getTip(o: OrderRow) {
  const cents = Number(o?.tip_cents ?? 0);
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  return cents / 100;
}

function emojiFromId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return TRIP_EMOJIS[h % TRIP_EMOJIS.length];
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

export function DriverRevenueHistoryScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { t, i18n } = useTranslation();

  const initialRange: RangeKey = (route?.params?.range as RangeKey) ?? "week";

  const [range, setRange] = useState<RangeKey>(initialRange);
  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [orders, setOrders] = useState<OrderRow[]>([]);

  const localeForDates = useMemo(() => {
    const lng = String(i18n.language || "en").toLowerCase();
    if (lng.startsWith("fr")) return "fr-FR";
    if (lng.startsWith("es")) return "es-ES";
    if (lng.startsWith("ar")) return "ar";
    if (lng.startsWith("zh")) return "zh-CN";
    if (lng.startsWith("ff")) return "fr-FR";
    return "en-US";
  }, [i18n.language]);

  const { fromISO, toISO, label } = useMemo(() => {
    const now = new Date();

    if (range === "today") {
      const from = startOfDay(now);
      const to = endOfDay(now);
      return {
        fromISO: from.toISOString(),
        toISO: to.toISOString(),
        label: t("driver.revenue.history.range.today", "Today"),
      };
    }
    if (range === "month") {
      const from = startOfMonth(now);
      const to = endOfDay(now);
      return {
        fromISO: from.toISOString(),
        toISO: to.toISOString(),
        label: t("driver.revenue.history.range.month", "This month"),
      };
    }
    // week
    const from = startOfWeekMonday(now);
    const to = endOfDay(now);
    return {
      fromISO: from.toISOString(),
      toISO: to.toISOString(),
      label: t("driver.revenue.history.range.week", "This week"),
    };
  }, [range, t]);

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        setOrders([]);
        Alert.alert(
          t("driver.revenue.history.auth.title", "Login"),
          t(
            "driver.revenue.history.auth.body",
            "Log in as a driver to view your earnings history.",
          ),
        );
        return;
      }

      const uid = sessionData.session.user.id;

      const { data: orderRows, error: ordersError } = await applyLiveTripFilters(
        supabase
          .from("orders")
          .select(
            "id, created_at, status, driver_id, driver_delivery_payout, tip_cents, kind, restaurant_name",
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
        driver_delivery_payout: Number.isFinite(Number(row.driver_delivery_payout))
          ? Number(row.driver_delivery_payout)
          : null,
        tip_cents: Number.isFinite(Number(row.tip_cents)) ? Number(row.tip_cents) : 0,
        kind: row.kind ?? null,
        restaurant_name: row.restaurant_name ?? null,
        source_table: "orders",
      }));

      const normalizedDeliveryRequests: OrderRow[] = ((deliveryRequestRows ?? []) as any[]).map((row) => ({
        id: String(row.id),
        created_at: row.created_at ?? null,
        status: row.status ?? null,
        driver_id: row.driver_id ?? null,
        driver_delivery_payout: Number.isFinite(Number(row.driver_delivery_payout))
          ? Number(row.driver_delivery_payout)
          : null,
        tip_cents: 0,
        kind: row.kind ?? "delivery",
        restaurant_name: null,
        source_table: "delivery_requests",
      }));

      setOrders(
        [...normalizedOrders, ...normalizedDeliveryRequests].sort(
          (a, b) =>
            new Date(b.created_at ?? 0).getTime() -
            new Date(a.created_at ?? 0).getTime(),
        ),
      );
    } catch (e: any) {
      console.log("fetchOrders history error:", e);
      Alert.alert(
        t("common.errorTitle", "Error"),
        e?.message ??
          t("driver.revenue.history.loadError", "Unable to load history."),
      );
      setOrders([]);
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }, [fromISO, toISO, t]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  // ✅ B: base + tips + total
  const totals = useMemo(() => {
    const baseEarnings = orders.reduce((sum, o) => sum + getGain(o), 0);
    const tipsTotal = orders.reduce((sum, o) => sum + getTip(o), 0);
    const totalEarnings = baseEarnings + tipsTotal;

    return { baseEarnings, tipsTotal, totalEarnings };
  }, [orders]);

  const showEmpty = !loading && orders.length === 0;
  const showList = !loading && orders.length > 0;

  const totalDisplay = loading
    ? "—"
    : fmtMoney(totals.totalEarnings);
  const netDisplay = loading ? "—" : fmtMoney(totals.baseEarnings);
  const tipsDisplay = loading ? "—" : fmtMoney(totals.tipsTotal);

  if (initialLoad && loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
        <ScreenHeader
          title={t("driver.revenue.history.title", "History")}
          subtitle={label}
          fallbackRoute="DriverTabs"
          variant="mmd"
        />
        <DriverBrandLoadingState title={t("common.loading", "Loading…")} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("driver.revenue.history.title", "History")}
        subtitle={label}
        fallbackRoute="DriverTabs"
        variant="mmd"
        rightSlot={
          <TouchableOpacity
            onPress={() => void fetchOrders()}
            style={[styles.refreshButton, loading && styles.disabled]}
            disabled={loading}
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
        <View style={styles.filtersRow}>
          {(["today", "week", "month"] as RangeKey[]).map((k) => {
            const active = k === range;
            const text =
              k === "today"
                ? t("driver.revenue.history.filters.today", "Today")
                : k === "week"
                  ? t("driver.revenue.history.filters.week", "Week")
                  : t("driver.revenue.history.filters.month", "Month");

            return (
              <TouchableOpacity
                key={k}
                onPress={() => setRange(k)}
                style={[
                  styles.filterPill,
                  loading && styles.filterPillLoading,
                  active && (loading ? styles.filterPillActiveLilac : styles.filterPillActive),
                ]}
                activeOpacity={0.86}
              >
                <Text
                  style={[
                    styles.filterText,
                    loading && styles.filterTextLoading,
                    active && (loading ? styles.filterTextActiveLilac : styles.filterTextActive),
                  ]}
                >
                  {text}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={[styles.summaryCard, loading && styles.summaryCardLoading]}>
          <View style={styles.summaryTopRow}>
            <View style={[styles.summaryIconBox, loading && styles.summaryIconBoxLilac]}>
              <Text style={[styles.summaryIcon, loading && styles.summaryIconLilac]}>
                {loading ? "$" : "💲"}
              </Text>
            </View>
            <View style={styles.livePill}>
              <Text style={styles.liveText}>
                {orders.length}{" "}
                {t("driver.revenue.history.summary.trips", "trips")}
              </Text>
            </View>
          </View>

          <Text style={styles.summaryLabel}>
            {t("driver.revenue.history.summary.totalLabel", "Total")}
          </Text>
          <Text style={styles.summaryAmount}>{totalDisplay}</Text>

          <View style={styles.splitRow}>
            <View style={[styles.splitCard, loading && styles.splitCardLoading]}>
              <Text style={styles.splitLabel}>
                {t("driver.revenue.history.summary.net", "Net price")}
              </Text>
              <Text style={styles.splitValue}>{netDisplay}</Text>
            </View>

            <View style={[styles.splitCard, loading && styles.splitCardLoading]}>
              <Text style={styles.splitLabel}>
                {t("driver.revenue.history.summary.tips", "Tips")}
              </Text>
              <Text style={styles.splitValueGreen}>{tipsDisplay}</Text>
            </View>
          </View>

          {!loading ? (
            <View style={styles.periodRow}>
              <Text style={styles.periodLabel}>
                {t("driver.revenue.history.summary.period", "Period:")}
              </Text>
              <Text style={styles.periodValue}>{label}</Text>
            </View>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.loadingFeedback}>
            <ActivityIndicator color={MMD_WHITE} />
            <Text style={styles.loadingText}>
              {t("common.loading", "Loading…")}
            </Text>
          </View>
        ) : null}

        {showEmpty ? (
          <>
            <View style={styles.emptyCard}>
              <Text style={styles.emptyEmoji}>📭</Text>
              <Text style={styles.emptyTitle}>
                {t(
                  "driver.revenue.history.list.empty",
                  "No delivered trips in this period.",
                )}
              </Text>
              <Text style={styles.emptySub}>
                {t(
                  "driver.revenue.history.list.emptySub",
                  "Completed deliveries will appear here.",
                )}
              </Text>
            </View>
            <BrandFooter stacked />
          </>
        ) : null}

        {showList ? (
          <>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>
                {t("driver.revenue.history.list.title", "Delivered trips")}
              </Text>
              <Text style={styles.sectionMeta}>{label}</Text>
            </View>

            <View style={styles.listWrap}>
              {orders.map((o) => {
                const base = getGain(o);
                const tip = getTip(o);
                const total = base + tip;
                const restaurant =
                  o.source_table === "delivery_requests"
                    ? "Delivery"
                    : o.restaurant_name ?? "—";

                return (
                  <TouchableOpacity
                    key={`${o.source_table}:${o.id}`}
                    onPress={() =>
                      navigation.navigate("DriverOrderDetails", {
                        orderId: o.id,
                        sourceTable: o.source_table,
                      })
                    }
                    style={styles.tripCard}
                    activeOpacity={0.86}
                  >
                    <View style={styles.tripTopRow}>
                      <View style={styles.tripLeft}>
                        <Text style={styles.tripEmoji}>{emojiFromId(o.id)}</Text>
                        <Text style={styles.tripMeta}>
                          {fmtTime(o.created_at, localeForDates)} · #
                          {o.id.slice(0, 8)}
                        </Text>
                      </View>
                      <Text style={styles.tripAmount}>{fmtMoney(total)}</Text>
                    </View>

                    <Text style={styles.restaurantName}>{restaurant}</Text>

                    <View style={styles.tripBreakdownRow}>
                      <Text style={styles.tripBreakdownText}>
                        {t(
                          "driver.revenue.history.list.netTipLine",
                          "Net price: {{net}} · Tip: {{tip}}",
                          {
                            net: fmtMoney(base),
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

            <BrandFooter />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const BORDER = "rgba(148,163,184,0.14)";
const MUTED_SOFT = "rgba(255,255,255,0.8)";

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
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
  disabled: { opacity: 0.65 },
  refreshText: {
    color: MMD_TEXT,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 12,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 20,
  },
  filtersRow: { flexDirection: "row", gap: 8 },
  filterPill: {
    flex: 1,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  filterPillLoading: {
    height: 44,
    backgroundColor: "rgba(0,51,204,0.72)",
    borderColor: BORDER,
  },
  filterPillActive: {
    backgroundColor: MMD_ACTION_NAVY,
    borderColor: "rgba(255,255,255,0.2)",
  },
  filterPillActiveLilac: {
    backgroundColor: "rgba(167,139,250,0.18)",
    borderColor: "rgba(167,139,250,0.5)",
  },
  filterText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 14,
  },
  filterTextLoading: {
    color: "#CBD5E1",
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 12,
  },
  filterTextActive: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  filterTextActiveLilac: {
    color: LILAC_SOFT,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 12,
  },
  summaryCard: {
    borderRadius: 14,
    padding: 20,
    backgroundColor: MMD_ACTION_NAVY,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    gap: 16,
  },
  summaryCardLoading: {
    borderRadius: 28,
    padding: 18,
    backgroundColor: "rgba(0,51,204,0.86)",
    borderColor: "rgba(167,139,250,0.18)",
    gap: 6,
  },
  summaryTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  summaryIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  summaryIconBoxLilac: {
    borderRadius: 16,
    backgroundColor: "rgba(167,139,250,0.16)",
    borderColor: "rgba(167,139,250,0.28)",
  },
  summaryIcon: {
    color: MMD_WHITE,
    fontSize: 22,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  summaryIconLilac: { color: LILAC },
  livePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(34,197,94,0.1)",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.22)",
  },
  liveText: {
    color: MMD_TAXI_GREEN,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 12,
  },
  summaryLabel: {
    color: MUTED_SOFT,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 13,
  },
  summaryAmount: {
    color: MMD_TEXT,
    fontSize: 36,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    marginTop: -8,
  },
  splitRow: { flexDirection: "row", gap: 12 },
  splitCard: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    backgroundColor: MMD_BLUE,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    gap: 4,
  },
  splitCardLoading: {
    borderRadius: 18,
    backgroundColor: "rgba(0,51,204,0.55)",
    borderColor: BORDER,
    gap: 5,
  },
  splitLabel: {
    color: MUTED_SOFT,
    fontSize: 12,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  splitValue: {
    color: MMD_TEXT,
    fontSize: 16,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  splitValueGreen: {
    color: MMD_TAXI_GREEN,
    fontSize: 16,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  periodRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  periodLabel: {
    color: MUTED_SOFT,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 12,
  },
  periodValue: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 12,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: MMD_WHITE,
    fontSize: 18,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  sectionMeta: {
    color: MUTED_SOFT,
    fontSize: 12,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
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
  emptyCard: {
    borderRadius: 14,
    padding: 18,
    backgroundColor: MMD_ACTION_NAVY,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    gap: 8,
  },
  emptyEmoji: { fontSize: 22 },
  emptyTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    textAlign: "center",
    fontSize: 16,
  },
  emptySub: {
    color: MMD_MUTED,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    textAlign: "center",
    fontSize: 13,
  },
  listWrap: { gap: 12 },
  tripCard: {
    borderRadius: 12,
    padding: 16,
    backgroundColor: MMD_ACTION_NAVY,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    gap: 12,
  },
  tripTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tripLeft: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  tripEmoji: {
    fontSize: 18,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  tripMeta: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 14,
  },
  tripAmount: {
    color: MMD_WHITE,
    fontSize: 18,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  restaurantName: {
    color: MUTED_SOFT,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 14,
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
    fontSize: 20,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingTop: 12,
  },
  footerStacked: {
    flexDirection: "column",
    gap: 12,
  },
  footerLogo: { width: 44, height: 44, borderRadius: 10 },
  footerBrand: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
  },
});
