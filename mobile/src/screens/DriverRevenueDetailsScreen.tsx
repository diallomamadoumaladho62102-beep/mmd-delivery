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
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
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

  // ✅ tip depuis DB (cents)
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
  // ✅ base payout chauffeur (sans tips)
  const g = o.driver_delivery_payout ?? o.delivery_fee ?? o.total ?? 0;
  return Number.isFinite(g) ? Number(g) : 0;
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

// ✅ RPC renvoie des SECONDES
type DriverStatsRow = {
  online_seconds: number | null;
  driving_seconds: number | null;
  trips?: number | null;
  points?: number | null;
};

export function DriverRevenueDetailsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { t, i18n } = useTranslation();

  const range: RangeKey = (route?.params?.range as RangeKey) ?? "week";

  const [loading, setLoading] = useState(false);
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

        const { data, error } = await supabase
          .from("orders")
          .select(
            "id, created_at, status, driver_id, driver_delivery_payout, delivery_fee, total, tip_cents, kind, restaurant_name"
          )
          .eq("driver_id", uid)
          .eq("status", "delivered")
          .gte("created_at", fromISO)
          .lte("created_at", toISO)
          .order("created_at", { ascending: false });

        if (error) throw error;

        if (!aliveRef.alive) return;
        setOrders((data ?? []) as OrderRow[]);
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

  // ✅ Bars: week => Mon..Sun, sinon => last 7 days
  const bars = useMemo(() => {
    if (range === "week") {
      const days = [
        t("driver.revenue.details.week.mon", "Mon"),
        t("driver.revenue.details.week.tue", "Tue"),
        t("driver.revenue.details.week.wed", "Wed"),
        t("driver.revenue.details.week.thu", "Thu"),
        t("driver.revenue.details.week.fri", "Fri"),
        t("driver.revenue.details.week.sat", "Sat"),
        t("driver.revenue.details.week.sun", "Sun"),
      ];
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
        h: Math.max(10, Math.round((map[label] / max) * 140)),
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
      h: Math.max(10, Math.round((map[d.key] / max) * 140)),
    }));
  }, [orders, range, toISO, t, localeForDates]);

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
    navigation.navigate("DriverOrderDetails", { orderId: last.id });
  }, [navigation, orders, t]);

  const onRefresh = useCallback(() => {
    const aliveRef = { alive: true };
    void fetchDetails(aliveRef);
    void fetchStats(aliveRef);
  }, [fetchDetails, fetchStats]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <View style={{ flex: 1 }}>
        {/* Header top bar */}
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

            <View style={{ alignItems: "center" }}>
              <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>{titleLabel}</Text>
              <Text
                style={{
                  color: "#9CA3AF",
                  marginTop: 2,
                  fontWeight: "800",
                  fontSize: 12,
                }}
              >
                {daysLabel}
              </Text>
            </View>

            <TouchableOpacity
              onPress={onRefresh}
              disabled={loading}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 999,
                backgroundColor: "rgba(15,23,42,0.7)",
                borderWidth: 1,
                borderColor: "#1F2937",
                opacity: loading ? 0.65 : 1,
              }}
            >
              <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
                {loading
                  ? t("shared.common.loadingEllipsis", "…")
                  : t("common.refresh", "Refresh")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
          {/* Graph (Uber-style top) */}
          <View
            style={{
              borderRadius: 18,
              backgroundColor: "rgba(15,23,42,0.65)",
              borderWidth: 1,
              borderColor: "#1F2937",
              padding: 16,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "flex-end",
              }}
            >
              <View>
                <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
                  {t("driver.revenue.details.earnings", "Earnings")}
                </Text>

                <Text
                  style={{
                    color: "white",
                    fontSize: 40,
                    fontWeight: "900",
                    marginTop: 6,
                  }}
                >
                  {fmtMoney(totals.totalEarnings)}
                </Text>

                <Text style={{ color: "#94A3B8", marginTop: 6, fontWeight: "800" }}>
                  {t("driver.revenue.details.tripsLabel", "Trips")} : {totals.trips}
                </Text>
              </View>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-end",
                  gap: 10,
                  paddingBottom: 4,
                }}
              >
                {bars.map((b) => (
                  <View key={b.label} style={{ alignItems: "center" }}>
                    <View
                      style={{
                        width: 18,
                        height: b.h,
                        borderRadius: 10,
                        backgroundColor: "rgba(59,130,246,0.95)",
                      }}
                    />
                    <Text
                      style={{
                        color: "#94A3B8",
                        fontSize: 11,
                        marginTop: 8,
                        fontWeight: "800",
                      }}
                    >
                      {b.label}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          {/* Statistiques */}
          <Text
            style={{
              color: "white",
              fontSize: 26,
              fontWeight: "900",
              marginTop: 18,
            }}
          >
            {t("driver.revenue.details.stats.title", "Stats")}
          </Text>

          <View
            style={{
              marginTop: 10,
              borderRadius: 18,
              backgroundColor: "rgba(15,23,42,0.65)",
              borderWidth: 1,
              borderColor: "#1F2937",
              padding: 16,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <View style={{ width: "48%" }}>
                <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
                  {t("driver.revenue.details.stats.online", "Online")}
                </Text>
                <Text style={{ color: "white", fontSize: 20, fontWeight: "900", marginTop: 6 }}>
                  {stats.online}
                </Text>
              </View>

              <View style={{ width: "48%" }}>
                <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
                  {t("driver.revenue.details.stats.driving", "Driving")}
                </Text>
                <Text style={{ color: "white", fontSize: 20, fontWeight: "900", marginTop: 6 }}>
                  {stats.driving}
                </Text>
              </View>
            </View>

            <View style={{ height: 1, backgroundColor: "#1F2937", marginVertical: 14 }} />

            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <View style={{ width: "48%" }}>
                <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
                  {t("driver.revenue.details.stats.trips", "Trips")}
                </Text>
                <Text style={{ color: "white", fontSize: 20, fontWeight: "900", marginTop: 6 }}>
                  {totals.trips}
                </Text>
              </View>

              <View style={{ width: "48%" }}>
                <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
                  {t("driver.revenue.details.stats.points", "Points")}
                </Text>
                <Text style={{ color: "white", fontSize: 20, fontWeight: "900", marginTop: 6 }}>
                  {totals.points}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              onPress={() =>
                Alert.alert(
                  t("driver.revenue.details.calc.title", "Calculation"),
                  t(
                    "driver.revenue.details.calc.body",
                    "Online/Driving come from RPC get_driver_stats(from_ts,to_ts). Trips = delivered. Points = number of trips."
                  )
                )
              }
              style={{ marginTop: 14 }}
            >
              <Text
                style={{
                  color: "#93C5FD",
                  fontWeight: "900",
                  textDecorationLine: "underline",
                }}
              >
                {t("driver.revenue.details.calc.link", "How we calculate stats")}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Détail */}
          <Text style={{ color: "white", fontSize: 26, fontWeight: "900", marginTop: 18 }}>
            {t("driver.revenue.details.breakdown.title", "Breakdown")}
          </Text>

          <View
            style={{
              marginTop: 10,
              borderRadius: 18,
              backgroundColor: "rgba(15,23,42,0.65)",
              borderWidth: 1,
              borderColor: "#1F2937",
              padding: 16,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 10 }}>
              <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
                {t("driver.revenue.details.breakdown.netPrice", "Net price")}
              </Text>
              <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
                {fmtMoney(totals.baseEarnings)}
              </Text>
            </View>

            <View style={{ height: 1, backgroundColor: "#1F2937" }} />

            <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 10 }}>
              <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
                {t("driver.revenue.details.breakdown.tip", "Tip")}
              </Text>
              <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
                {fmtMoney(totals.tips)}
              </Text>
            </View>

            <View style={{ height: 1, backgroundColor: "#1F2937" }} />

            <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 10 }}>
              <Text style={{ color: "white", fontWeight: "900" }}>
                {t("driver.revenue.details.breakdown.total", "Total earnings")}
              </Text>
              <Text style={{ color: "white", fontWeight: "900" }}>
                {fmtMoney(totals.totalEarnings)}
              </Text>
            </View>

            <TouchableOpacity
              onPress={openLastPriceDetails}
              style={{
                marginTop: 12,
                height: 52,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(2,6,23,0.55)",
                borderWidth: 1,
                borderColor: "#1F2937",
              }}
            >
              <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
                {t("driver.revenue.details.breakdown.viewLastTripPrice", "View trip price details")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => navigation.navigate("DriverRevenueHistory", { range })}
              style={{
                marginTop: 10,
                height: 52,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(15,23,42,0.35)",
                borderWidth: 1,
                borderColor: "#1F2937",
              }}
            >
              <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
                {t("driver.revenue.details.breakdown.viewHistory", "View earnings history")}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Courses terminées */}
          <Text style={{ color: "white", fontSize: 26, fontWeight: "900", marginTop: 18 }}>
            {t("driver.revenue.details.completed.title", "Completed trips")}
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
              {t("driver.revenue.details.completed.empty", "No delivered trip in this period.")}
            </Text>
          ) : (
            <View style={{ marginTop: 10, gap: 10 }}>
              {orders.slice(0, 30).map((o) => {
                const gain = getGain(o);
                const tip = getTip(o);

                return (
                  <TouchableOpacity
                    key={o.id}
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
                            restaurant: o.restaurant_name ?? "—",
                          }
                        )
                      )
                    }
                    style={{
                      borderRadius: 18,
                      padding: 14,
                      backgroundColor: "rgba(15,23,42,0.65)",
                      borderWidth: 1,
                      borderColor: "#1F2937",
                    }}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ color: "white", fontSize: 22, fontWeight: "900" }}>
                        {fmtMoney(gain + tip)}
                      </Text>
                      <Text style={{ color: "#94A3B8", fontWeight: "900" }}>
                        {fmtShortDate(o.created_at, localeForDates)}
                      </Text>
                    </View>

                    <Text style={{ color: "#94A3B8", marginTop: 6, fontWeight: "800" }}>
                      {fmtTime(o.created_at, localeForDates)} · #{o.id.slice(0, 8)}
                      {o.restaurant_name ? ` · ${o.restaurant_name}` : ""}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {driverId && (
            <Text style={{ color: "#334155", marginTop: 18, fontSize: 11 }}>
              {t("driver.revenue.details.driverId", "Driver")} : {driverId.slice(0, 8)}…
            </Text>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
