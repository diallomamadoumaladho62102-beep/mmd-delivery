import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";

type RangeKey = "today" | "week" | "month";

type OrderRow = {
  id: string;
  created_at: string | null;
  status: string | null;
  driver_id: string | null;

  driver_delivery_payout: number | null;
  delivery_fee: number | null;
  total: number | null;

  // ✅ tip (en cents) — ajouté sans casser le reste
  tip_cents?: number | null;

  kind: string | null;
  restaurant_name: string | null;
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
function getGain(o: OrderRow) {
  const g = o.driver_delivery_payout ?? o.delivery_fee ?? o.total ?? 0;
  return Number.isFinite(g) ? Number(g) : 0;
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
          t("driver.revenue.history.auth.body", "Log in as a driver to view your earnings history.")
        );
        return;
      }

      const uid = sessionData.session.user.id;

      const { data, error } = await supabase
        .from("orders")
        .select(
          // ✅ A1: tip_cents dans le SELECT
          "id, created_at, status, driver_id, driver_delivery_payout, delivery_fee, total, tip_cents, kind, restaurant_name"
        )
        .eq("driver_id", uid)
        .eq("status", "delivered")
        .gte("created_at", fromISO)
        .lte("created_at", toISO)
        .order("created_at", { ascending: false });

      if (error) throw error;

      setOrders((data ?? []) as OrderRow[]);
    } catch (e: any) {
      console.log("fetchOrders history error:", e);
      Alert.alert(
        t("common.errorTitle", "Error"),
        e?.message ?? t("driver.revenue.history.loadError", "Unable to load history.")
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
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={{ paddingVertical: 8, paddingRight: 10 }}
          >
            <Text style={{ color: "#93C5FD", fontWeight: "900" }}>←</Text>
          </TouchableOpacity>

          <View style={{ alignItems: "center" }}>
            <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
              {t("driver.revenue.history.title", "History")}
            </Text>
            <Text
              style={{
                color: "#9CA3AF",
                marginTop: 2,
                fontWeight: "800",
                fontSize: 12,
              }}
            >
              {label}
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => void fetchOrders()}
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
              {loading ? t("shared.common.loadingEllipsis", "…") : t("common.refresh", "Refresh")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
        {/* Filtres */}
        <View style={{ flexDirection: "row", gap: 10 }}>
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
                style={{
                  flex: 1,
                  height: 44,
                  borderRadius: 999,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: active ? "rgba(59,130,246,0.25)" : "rgba(15,23,42,0.65)",
                  borderWidth: 1,
                  borderColor: active ? "#60A5FA" : "#1F2937",
                }}
              >
                <Text
                  style={{
                    color: active ? "#BFDBFE" : "#E5E7EB",
                    fontWeight: "900",
                    fontSize: 12,
                  }}
                >
                  {text}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Résumé */}
        <View
          style={{
            marginTop: 14,
            borderRadius: 18,
            backgroundColor: "rgba(15,23,42,0.65)",
            borderWidth: 1,
            borderColor: "#1F2937",
            padding: 16,
          }}
        >
          <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
            {t("driver.revenue.history.summary.totalLabel", "Total")}
          </Text>
          <Text
            style={{
              color: "white",
              fontSize: 34,
              fontWeight: "900",
              marginTop: 6,
            }}
          >
            {fmtMoney(totals.totalEarnings)}
          </Text>

          <Text style={{ color: "#94A3B8", marginTop: 6, fontWeight: "800" }}>
            {t(
              "driver.revenue.history.summary.netAndTips",
              "Net price: {{net}} · Tips: {{tips}}",
              { net: fmtMoney(totals.baseEarnings), tips: fmtMoney(totals.tipsTotal) }
            )}
          </Text>

          <Text style={{ color: "#94A3B8", marginTop: 6, fontWeight: "800" }}>
            {t("driver.revenue.history.summary.trips", "Trips")} : {orders.length}
          </Text>
        </View>

        {/* Liste */}
        <Text style={{ color: "white", fontSize: 22, fontWeight: "900", marginTop: 18 }}>
          {t("driver.revenue.history.list.title", "Delivered trips")}
        </Text>

        {loading ? (
          <View style={{ marginTop: 10, flexDirection: "row", alignItems: "center", gap: 10 }}>
            <ActivityIndicator color="#fff" />
            <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
              {t("common.loading", "Loading…")}
            </Text>
          </View>
        ) : orders.length === 0 ? (
          <Text style={{ color: "#9CA3AF", marginTop: 10 }}>
            {t("driver.revenue.history.list.empty", "No delivered trips in this period.")}
          </Text>
        ) : (
          <View style={{ marginTop: 10, gap: 10 }}>
            {orders.map((o) => {
              const base = getGain(o);
              const tip = getTip(o);
              const total = base + tip;

              return (
                <TouchableOpacity
                  key={o.id}
                  onPress={() => navigation.navigate("DriverOrderDetails", { orderId: o.id })}
                  style={{
                    borderRadius: 18,
                    padding: 14,
                    backgroundColor: "rgba(15,23,42,0.65)",
                    borderWidth: 1,
                    borderColor: "#1F2937",
                  }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: "white", fontSize: 20, fontWeight: "900" }}>
                      {fmtMoney(total)}
                    </Text>
                    <Text style={{ color: "#94A3B8", fontWeight: "900" }}>
                      {fmtShortDate(o.created_at, localeForDates)}
                    </Text>
                  </View>

                  <Text style={{ color: "#94A3B8", marginTop: 6, fontWeight: "800" }}>
                    {fmtTime(o.created_at, localeForDates)} · #{o.id.slice(0, 8)}
                    {o.restaurant_name ? ` · ${o.restaurant_name}` : ""}
                  </Text>

                  <Text
                    style={{ color: "#64748B", marginTop: 6, fontWeight: "800", fontSize: 12 }}
                  >
                    {t(
                      "driver.revenue.history.list.netTipLine",
                      "Net price: {{net}} · Tip: {{tip}}",
                      { net: fmtMoney(base), tip: fmtMoney(tip) }
                    )}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
