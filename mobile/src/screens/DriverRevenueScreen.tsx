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

  // ✅ tip du client (en cents)
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

function getGain(o: OrderRow) {
  const g = o.driver_delivery_payout ?? o.delivery_fee ?? o.total ?? 0;
  return Number.isFinite(g) ? Number(g) : 0;
}

function getTip(o: OrderRow) {
  const cents = Number(o?.tip_cents ?? 0);
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  return cents / 100;
}

export function DriverRevenueScreen() {
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation();

  const [range, setRange] = useState<RangeKey>("week");
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [driverId, setDriverId] = useState<string | null>(null);

  // ✅ locale dynamique (selon langue i18n)
  const locale = useMemo(() => {
    const lng = (i18n.language || "en").toLowerCase();
    if (lng.startsWith("fr")) return "fr-FR";
    if (lng.startsWith("ar")) return "ar";
    return "en-US";
  }, [i18n.language]);

  function fmtShortDate(iso: string | null) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString(locale, { day: "2-digit", month: "short" });
  }

  function fmtTimeRange(iso: string | null) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  }

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

    // week
    const from = startOfWeekMonday(now);
    const to = endOfDay(now);

    const fromTxt = from.toLocaleDateString(locale, {
      day: "2-digit",
      month: "short",
    });
    const toTxt = now.toLocaleDateString(locale, {
      day: "2-digit",
      month: "short",
    });

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
          t(
            "driver.revenue.auth_body",
            "Log in as a driver to see your earnings."
          )
        );
        return;
      }

      const uid = sessionData.session.user.id;
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

      setOrders((data ?? []) as OrderRow[]);
    } catch (e: any) {
      console.log("fetchRevenue error:", e);
      Alert.alert(
        t("shared.orderChat.alerts.errorTitle", "Error"),
        e?.message ?? t("driver.revenue.load_error", "Unable to load earnings.")
      );
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [fromISO, toISO, t]);

  useFocusEffect(
    useCallback(() => {
      void fetchRevenue();
    }, [fetchRevenue])
  );

  useEffect(() => {
    void fetchRevenue();
  }, [range, fetchRevenue]);

  // ✅ B: base + tips + total
  const totals = useMemo(() => {
    const trips = orders.length;

    const baseEarnings = orders.reduce((sum, o) => sum + getGain(o), 0);
    const tips = orders.reduce((sum, o) => sum + getTip(o), 0);
    const totalEarnings = baseEarnings + tips;

    const points = trips;

    return { trips, baseEarnings, tips, totalEarnings, points };
  }, [orders]);

  const weekBars = useMemo(() => {
    // ✅ Le graph reste sur le base payout
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
      const js = d.getDay(); // 0 Sun
      const idx = js === 0 ? 6 : js - 1;
      const key = days[idx];
      map[key] += getGain(o);
    }

    const max = Math.max(1, ...Object.values(map));
    return days.map((label) => ({
      label,
      value: map[label],
      h: Math.max(10, Math.round((map[label] / max) * 64)),
    }));
  }, [orders, t]);

  function safeNavigate(routeName: string, params?: any) {
    try {
      navigation.navigate(routeName, params);
    } catch (e) {
      Alert.alert(
        t("common.soon", "Coming soon ✅"),
        t(
          "driver.revenue.not_added",
          `The page "${routeName}" is not yet added in AppNavigator.`
        )
      );
    }
  }

  const openDetails = () => safeNavigate("DriverRevenueDetails", { range });
  const openWallet = () => safeNavigate("DriverWallet");
  const openBenefits = () => safeNavigate("DriverBenefits");

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <View style={{ flex: 1 }}>
        {/* Header */}
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
              <Text style={{ color: "#93C5FD", fontWeight: "800" }}>
                {t("shared.common.backArrowOnly", "←")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() =>
                Alert.alert(
                  t("driver.revenue.help_title", "Help"),
                  t(
                    "driver.revenue.help_body",
                    "We will add a Help page here (FAQ / Support)."
                  )
                )
              }
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 999,
                backgroundColor: "rgba(15,23,42,0.7)",
                borderWidth: 1,
                borderColor: "#1F2937",
              }}
            >
              <Text style={{ color: "#E5E7EB", fontWeight: "800" }}>
                {t("driver.revenue.help_btn", "Help")}
              </Text>
            </TouchableOpacity>
          </View>

          <Text
            style={{
              color: "white",
              fontSize: 34,
              fontWeight: "900",
              marginTop: 6,
            }}
          >
            {t("driver.revenue.title", "Earnings")}
          </Text>

          <Text style={{ color: "#9CA3AF", marginTop: 2, fontSize: 13 }}>
            {titleLabel}
          </Text>

          {/* Tabs */}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
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
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 14,
                    borderRadius: 999,
                    backgroundColor: active
                      ? "rgba(59,130,246,0.18)"
                      : "rgba(15,23,42,0.5)",
                    borderWidth: 1,
                    borderColor: active ? "#3B82F6" : "#1F2937",
                  }}
                >
                  <Text
                    style={{
                      color: active ? "#93C5FD" : "#E5E7EB",
                      fontWeight: "800",
                    }}
                  >
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Body */}
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
          {/* Total + mini graph */}
          <View
            style={{
              borderRadius: 18,
              backgroundColor: "rgba(15,23,42,0.65)",
              borderWidth: 1,
              borderColor: "#1F2937",
              padding: 16,

              // ✅ FIX iOS : empêche les barres de dépasser / se voir derrière la card
              overflow: "hidden",
              position: "relative",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "flex-end",
              }}
            >
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
                  {t("driver.revenue.total", "Total")}
                </Text>

                {/* ✅ Total = base + tips */}
                <Text
                  style={{
                    color: "white",
                    fontSize: 44,
                    fontWeight: "900",
                    marginTop: 4,
                  }}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {fmtMoney(totals.totalEarnings)}
                </Text>

                <Text
                  style={{
                    color: "#94A3B8",
                    marginTop: 6,
                    fontWeight: "800",
                  }}
                  numberOfLines={1}
                >
                  {t("driver.revenue.net_price", "Net")}:{" "}
                  {fmtMoney(totals.baseEarnings)} ·{" "}
                  {t("driver.revenue.tips", "Tips")}: {fmtMoney(totals.tips)}
                </Text>
              </View>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-end",
                  gap: 6,
                  paddingBottom: 6,
                }}
              >
                {weekBars.map((b) => (
                  <View key={b.label} style={{ alignItems: "center" }}>
                    <View
                      style={{
                        width: 10,
                        height: b.h,
                        borderRadius: 8,
                        backgroundColor: "rgba(59,130,246,0.95)",
                      }}
                    />
                    <Text
                      style={{
                        color: "#94A3B8",
                        fontSize: 10,
                        marginTop: 6,
                      }}
                    >
                      {b.label}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            <View
              style={{
                height: 1,
                backgroundColor: "#1F2937",
                marginVertical: 14,
              }}
            />

            <View style={{ gap: 10 }}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                }}
              >
                <Text style={{ color: "#9CA3AF", fontWeight: "700" }}>
                  {t("driver.revenue.trips", "Trips")}
                </Text>
                <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
                  {totals.trips}
                </Text>
              </View>

              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                }}
              >
                <Text style={{ color: "#9CA3AF", fontWeight: "700" }}>
                  {t("driver.revenue.points", "Points")}
                </Text>
                <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
                  {totals.points}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              onPress={openDetails}
              style={{
                marginTop: 14,
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
                {t("driver.revenue.show_details", "Show details")}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Cards */}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <TouchableOpacity
              onPress={openDetails}
              style={{
                flex: 1,
                borderRadius: 16,
                padding: 12,
                backgroundColor: "rgba(15,23,42,0.6)",
                borderWidth: 1,
                borderColor: "#1F2937",
                minHeight: 78,
              }}
            >
              <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
                {t("driver.revenue.activity", "Activity")}
              </Text>
              <Text
                style={{
                  color: "#94A3B8",
                  marginTop: 6,
                  fontWeight: "700",
                }}
              >
                {t("driver.revenue.activity_hint", "Time & trips")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={openWallet}
              style={{
                flex: 1,
                borderRadius: 16,
                padding: 12,
                backgroundColor: "rgba(15,23,42,0.6)",
                borderWidth: 1,
                borderColor: "#1F2937",
                minHeight: 78,
              }}
            >
              <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
                {t("driver.revenue.wallet", "Wallet")}
              </Text>
              <Text
                style={{
                  color: "#94A3B8",
                  marginTop: 6,
                  fontWeight: "700",
                }}
              >
                {t("driver.revenue.wallet_hint", "Balance & payouts")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={openBenefits}
              style={{
                flex: 1,
                borderRadius: 16,
                padding: 12,
                backgroundColor: "rgba(15,23,42,0.6)",
                borderWidth: 1,
                borderColor: "#1F2937",
                minHeight: 78,
              }}
            >
              <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
                {t("driver.revenue.benefits", "Benefits")}
              </Text>
              <Text
                style={{
                  color: "#94A3B8",
                  marginTop: 6,
                  fontWeight: "700",
                }}
              >
                {t("driver.revenue.benefits_hint", "Bonuses & boosts")}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Sessions */}
          <Text
            style={{
              color: "white",
              fontSize: 22,
              fontWeight: "900",
              marginTop: 18,
            }}
          >
            {t("driver.revenue.recent_sessions", "Recent sessions")}
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
              <Text style={{ color: "#9CA3AF", fontWeight: "700" }}>
                {t("shared.common.loading", "Loading…")}
              </Text>
            </View>
          ) : orders.length === 0 ? (
            <Text style={{ color: "#9CA3AF", marginTop: 10 }}>
              {t(
                "driver.revenue.no_trips",
                "No delivered trips in this period."
              )}
            </Text>
          ) : (
            <View style={{ marginTop: 10, gap: 10 }}>
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
                        `${t("driver.revenue.trip_id", "ID")}: ${o.id}\n${t(
                          "driver.revenue.net_price",
                          "Net"
                        )}: ${fmtMoney(base)}\n${t(
                          "driver.revenue.tip",
                          "Tip"
                        )}: ${fmtMoney(tip)}\n${t(
                          "driver.revenue.total",
                          "Total"
                        )}: ${fmtMoney(total)}`
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
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                      }}
                    >
                      <Text
                        style={{
                          color: "white",
                          fontSize: 20,
                          fontWeight: "900",
                        }}
                      >
                        {fmtMoney(total)}
                      </Text>
                      <Text style={{ color: "#94A3B8", fontWeight: "800" }}>
                        {fmtShortDate(o.created_at)}
                      </Text>
                    </View>

                    <Text
                      style={{
                        color: "#94A3B8",
                        marginTop: 6,
                        fontWeight: "800",
                      }}
                    >
                      {fmtTimeRange(o.created_at)} · #{o.id.slice(0, 8)}
                      {o.restaurant_name ? ` · ${o.restaurant_name}` : ""}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {driverId && (
            <Text style={{ color: "#334155", marginTop: 18, fontSize: 11 }}>
              {t("driver.revenue.driver_label", "Driver")}: {driverId.slice(0, 8)}…
            </Text>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
