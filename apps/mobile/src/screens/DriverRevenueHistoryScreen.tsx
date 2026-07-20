import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { applyLiveTripFilters } from "../lib/tripVisibility";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { APP_COLORS } from "../theme/appTheme";

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

function fmtShortDate(iso: string | null, locale: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(locale || "en-US", {
    day: "2-digit",
    month: "short",
  });
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

export function DriverRevenueHistoryScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { t, i18n } = useTranslation();

  const initialRange: RangeKey = (route?.params?.range as RangeKey) ?? "week";

  const [range, setRange] = useState<RangeKey>(initialRange);
  const [loading, setLoading] = useState(false);
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

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("driver.revenue.history.title", "History")}
        subtitle={label}
        fallbackRoute="DriverTabs"
        variant="dark"
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
                style={[styles.filterPill, active && styles.filterPillActive]}
                activeOpacity={0.86}
              >
                <Text
                  style={[styles.filterText, active && styles.filterTextActive]}
                >
                  {text}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.summaryCard}>
          <View style={styles.summaryTopRow}>
            <View style={styles.summaryIconBox}>
              <Text style={styles.summaryIcon}>$</Text>
            </View>
            <View style={styles.livePill}>
              <Text style={styles.liveText}>{orders.length} trips</Text>
            </View>
          </View>

          <Text style={styles.summaryLabel}>
            {t("driver.revenue.history.summary.totalLabel", "Total")}
          </Text>
          <Text style={styles.summaryAmount}>
            {fmtMoney(totals.totalEarnings)}
          </Text>

          <View style={styles.splitRow}>
            <View style={styles.splitCard}>
              <Text style={styles.splitLabel}>
                {t("driver.revenue.history.summary.net", "Net price")}
              </Text>
              <Text style={styles.splitValue}>
                {fmtMoney(totals.baseEarnings)}
              </Text>
            </View>

            <View style={styles.splitCard}>
              <Text style={styles.splitLabel}>
                {t("driver.revenue.history.summary.tips", "Tips")}
              </Text>
              <Text style={styles.splitValueGreen}>
                {fmtMoney(totals.tipsTotal)}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>
            {t("driver.revenue.history.list.title", "Delivered trips")}
          </Text>
          <Text style={styles.sectionMeta}>{label}</Text>
        </View>

        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#FFFFFF" />
            <Text style={styles.loadingText}>
              {t("common.loading", "Loading…")}
            </Text>
          </View>
        ) : orders.length === 0 ? (
          <View style={styles.emptyCard}>
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
        ) : (
          <View style={styles.listWrap}>
            {orders.map((o) => {
              const base = getGain(o);
              const tip = getTip(o);
              const total = base + tip;

              return (
                <TouchableOpacity
                  key={`${o.source_table}:${o.id}`}
                  onPress={() =>
                    navigation.navigate("DriverOrderDetails", { orderId: o.id, sourceTable: o.source_table })
                  }
                  style={styles.tripCard}
                  activeOpacity={0.86}
                >
                  <View style={styles.tripTopRow}>
                    <View>
                      <Text style={styles.tripAmount}>{fmtMoney(total)}</Text>
                      <Text style={styles.tripMeta}>
                        {fmtTime(o.created_at, localeForDates)} · #
                        {o.id.slice(0, 8)}
                      </Text>
                    </View>

                    <View style={styles.datePill}>
                      <Text style={styles.datePillText}>
                        {fmtShortDate(o.created_at, localeForDates)}
                      </Text>
                    </View>
                  </View>

                  {o.source_table === "delivery_requests" ? (
                    <Text style={styles.restaurantName}>Delivery</Text>
                  ) : o.restaurant_name ? (
                    <Text style={styles.restaurantName}>
                      {o.restaurant_name}
                    </Text>
                  ) : null}

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
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const BG = "#020617";
const CARD = "rgba(15,23,42,0.86)";
const CARD_SOFT = "rgba(2,6,23,0.72)";
const BORDER = "rgba(148,163,184,0.14)";
const PURPLE = APP_COLORS.accent;
const PURPLE_DARK = "#8B5CF6";
const GREEN = "#22C55E";
const TEXT = "#F8FAFC";
const MUTED = "#94A3B8";

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  headerWrap: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8 },
  headerRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerCenter: { alignItems: "center", flex: 1, paddingHorizontal: 12 },
  headerTitle: { color: TEXT, fontSize: 17, fontWeight: "900" },
  headerSubtitle: {
    color: MUTED,
    marginTop: 3,
    fontWeight: "800",
    fontSize: 12,
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
  backText: {
    color: "#BFDBFE",
    fontSize: 34,
    fontWeight: "700",
    marginTop: -2,
  },
  refreshButton: {
    minWidth: 82,
    height: 42,
    borderRadius: 999,
    backgroundColor: CARD_SOFT,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  disabled: { opacity: 0.65 },
  refreshText: { color: TEXT, fontWeight: "900", fontSize: 12 },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 32 },
  filtersRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  filterPill: {
    flex: 1,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CARD_SOFT,
    borderWidth: 1,
    borderColor: BORDER,
  },
  filterPillActive: {
    backgroundColor: "rgba(139,92,246,0.18)",
    borderColor: "rgba(167,139,250,0.5)",
  },
  filterText: { color: "#CBD5E1", fontWeight: "900", fontSize: 12 },
  filterTextActive: { color: "#DDD6FE" },
  summaryCard: {
    borderRadius: 28,
    padding: 18,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.18)",
    shadowColor: PURPLE_DARK,
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  summaryTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  summaryIconBox: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(139,92,246,0.16)",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.28)",
  },
  summaryIcon: { color: PURPLE, fontSize: 22, fontWeight: "900" },
  livePill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(34,197,94,0.1)",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.22)",
  },
  liveText: { color: GREEN, fontWeight: "900", fontSize: 12 },
  summaryLabel: { color: MUTED, fontWeight: "900" },
  summaryAmount: { color: TEXT, fontSize: 40, fontWeight: "900", marginTop: 6 },
  splitRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  splitCard: {
    flex: 1,
    borderRadius: 18,
    padding: 12,
    backgroundColor: "rgba(2,6,23,0.55)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  splitLabel: { color: MUTED, fontSize: 12, fontWeight: "800" },
  splitValue: { color: TEXT, marginTop: 5, fontSize: 17, fontWeight: "900" },
  splitValueGreen: {
    color: GREEN,
    marginTop: 5,
    fontSize: 17,
    fontWeight: "900",
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginTop: 22,
    marginBottom: 10,
  },
  sectionTitle: { color: TEXT, fontSize: 21, fontWeight: "900" },
  sectionMeta: { color: MUTED, fontSize: 12, fontWeight: "800" },
  loadingRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  loadingText: { color: MUTED, fontWeight: "800" },
  emptyCard: {
    borderRadius: 22,
    padding: 18,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
  },
  emptyTitle: { color: "#CBD5E1", fontWeight: "900", textAlign: "center" },
  emptySub: {
    color: "#64748B",
    fontWeight: "700",
    textAlign: "center",
    marginTop: 6,
  },
  listWrap: { gap: 10 },
  tripCard: {
    borderRadius: 22,
    padding: 15,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  tripTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  tripAmount: { color: TEXT, fontSize: 22, fontWeight: "900" },
  tripMeta: { color: MUTED, marginTop: 6, fontWeight: "800" },
  datePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(139,92,246,0.14)",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.22)",
  },
  datePillText: { color: "#DDD6FE", fontSize: 11, fontWeight: "900" },
  restaurantName: { color: "#CBD5E1", marginTop: 9, fontWeight: "800" },
  tripBreakdownRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
  },
  tripBreakdownText: {
    color: "#64748B",
    fontWeight: "800",
    fontSize: 12,
    flex: 1,
    paddingRight: 10,
  },
  chevron: { color: "#CBD5E1", fontSize: 28, fontWeight: "600", marginTop: -2 },
});
