// apps/mobile/src/screens/RestaurantEarningsScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  View,
  Text,
  StatusBar,
  TouchableOpacity,
  ScrollView,
  Alert,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import * as Clipboard from "expo-clipboard";
import { supabase } from "../lib/supabase";
import { getApiBaseUrl } from "../lib/apiBase";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { RestaurantBrandLoadingState } from "../components/restaurant/RestaurantBrandLoadingState";
import { logTechnicalError } from "../lib/userFacingError";
import {
  deriveRestaurantConnectStatus,
  stripeConnectStatusLabel,
  stripeConnectUserMessage,
} from "../lib/stripeConnectStatus";
import { RestaurantStripeConnectCard } from "../features/restaurant/components/RestaurantStripeConnectCard";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GLASS,
  MMD_TAXI_GREEN,
  MMD_TEXT,
  MMD_WHITE,
} from "../theme/mmdUi";

type OrderStatus =
  | "pending"
  | "accepted"
  | "prepared"
  | "ready"
  | "dispatched"
  | "delivered"
  | "canceled";

type MonthFilter = "this_month" | "prev_month";

type Row = {
  id: string;
  created_at: string | null;
  status: OrderStatus;

  currency: string | null;

  subtotal: number | null;
  tax: number | null;
  total: number | null;

  restaurant_commission_rate: number | null;
  restaurant_commission_amount: number | null;
  restaurant_net_amount: number | null;

  restaurant_paid_out: boolean | null;
  restaurant_paid_out_at: string | null;

  restaurant_transfer_id: string | null;
  restaurant_payout_id: string | null;

  dropoff_code_verified_at?: string | null;
};

type RestaurantPayoutProfile = {
  user_id: string;
  stripe_account_id: string | null;
  stripe_onboarding_status: string | null;
  stripe_charges_enabled: boolean | null;
  stripe_payouts_enabled: boolean | null;
  stripe_details_submitted: boolean | null;
};

const IS_DEV = typeof __DEV__ !== "undefined" ? __DEV__ : false;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function getBestDate(r: Row) {
  return r.dropoff_code_verified_at ?? r.created_at ?? null;
}

export function RestaurantEarningsScreen() {
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [payoutProfile, setPayoutProfile] =
    useState<RestaurantPayoutProfile | null>(null);

  const [serverPendingPayout, setServerPendingPayout] = useState<number | null>(
    null,
  );

  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [monthFilter, setMonthFilter] = useState<MonthFilter>("this_month");

  const barAnim = useRef(new Animated.Value(0)).current;

  const locale = useMemo(() => {
    const lng = String(i18n.language || "en").toLowerCase();
    if (lng.startsWith("fr")) return "fr-FR";
    if (lng.startsWith("es")) return "es-ES";
    if (lng.startsWith("ar")) return "ar";
    if (lng.startsWith("zh")) return "zh";
    if (lng.startsWith("ff")) return "ff";
    return "en-US";
  }, [i18n.language]);

  const money = useCallback(
    (n: number | null | undefined, currency: string) => {
      if (n == null || Number.isNaN(n)) return t("common.dash", "—");
      return `${Number(n).toFixed(2)} ${currency}`;
    },
    [t]
  );

  const fmtDateTime = useCallback(
    (iso?: string | null) => {
      if (!iso) return t("common.dash", "—");
      const d = new Date(iso);
      return d.toLocaleString(locale);
    },
    [locale, t]
  );

  const monthBounds = useCallback(
    (which: MonthFilter) => {
      const now = new Date();
      const y = now.getUTCFullYear();
      const m = now.getUTCMonth();

      const thisStart = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
      const nextStart = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
      const prevStart = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));

      if (which === "this_month") {
        return {
          label: t("restaurant.earnings.filters.thisMonth", "Ce mois"),
          short: `${thisStart.toISOString().slice(0, 10)} → ${nextStart
            .toISOString()
            .slice(0, 10)}`,
          startISO: thisStart.toISOString(),
          endISO: nextStart.toISOString(),
        };
      }

      return {
        label: t("restaurant.earnings.filters.prevMonth", "Mois précédent"),
        short: `${prevStart.toISOString().slice(0, 10)} → ${thisStart
          .toISOString()
          .slice(0, 10)}`,
        startISO: prevStart.toISOString(),
        endISO: thisStart.toISOString(),
      };
    },
    [t]
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;

        const uid = data?.user?.id ?? null;

        if (!uid) {
          if (!cancelled) setRestaurantId(null);
          return;
        }

        const { data: roleProfile, error: roleError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", uid)
          .maybeSingle();

        if (roleError) {
          console.log("RestaurantEarnings role check error:", roleError);
        }

        const role = String((roleProfile as any)?.role || "")
          .trim()
          .toLowerCase();

        if (role && role !== "restaurant") {
          if (!cancelled) setRestaurantId(null);

          navigation.reset({
            index: 0,
            routes: [
              {
                name:
                  role === "driver"
                    ? "DriverTabs"
                    : role === "client"
                      ? "ClientHome"
                      : "RoleSelect",
              },
            ],
          });
          return;
        }

        const { data: restaurantProfile, error: restaurantError } = await supabase
          .from("restaurant_profiles")
          .select("user_id,status")
          .eq("user_id", uid)
          .maybeSingle();

        if (restaurantError) {
          console.log("RestaurantEarnings profile check error:", restaurantError);
        }

        if (!restaurantProfile) {
          if (!cancelled) setRestaurantId(null);
          navigation.replace("RestaurantSetup");
          return;
        }

        if (!cancelled) setRestaurantId(uid);
      } catch (e: any) {
        console.log("getUser error:", e?.message ?? e);
        if (!cancelled) setRestaurantId(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigation]);

  const fetchPayoutProfile = useCallback(async () => {
    try {
      const {
        data: { session },
        error: sessionErr,
      } = await supabase.auth.getSession();

      if (sessionErr) throw sessionErr;
      if (!session?.user) {
        setPayoutProfile(null);
        return;
      }

      const { data: connectData, error: connectErr } = await supabase.functions.invoke(
        "check_connect_status",
        {
          body: { role: "restaurant" },
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );
      if (connectErr) {
        logTechnicalError("restaurant.earnings.check_connect_status", connectErr);
      }

      const { data, error } = await supabase
        .from("restaurant_profiles")
        .select(
          [
            "user_id",
            "stripe_account_id",
            "stripe_onboarding_status",
            "stripe_charges_enabled",
            "stripe_payouts_enabled",
            "stripe_details_submitted",
          ].join(",")
        )
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (error) throw error;

      let profile = (data as unknown as RestaurantPayoutProfile | null) ?? null;
      if (connectData && typeof connectData === "object" && profile) {
        const connect = connectData as Record<string, unknown>;
        profile = {
          ...profile,
          stripe_account_id:
            connect.stripe_account_id != null
              ? String(connect.stripe_account_id)
              : profile.stripe_account_id,
          stripe_onboarding_status:
            typeof connect.status === "string"
              ? connect.status
              : profile.stripe_onboarding_status,
          stripe_charges_enabled:
            typeof connect.charges_enabled === "boolean"
              ? connect.charges_enabled
              : profile.stripe_charges_enabled,
          stripe_payouts_enabled:
            typeof connect.payouts_enabled === "boolean"
              ? connect.payouts_enabled
              : profile.stripe_payouts_enabled,
          stripe_details_submitted:
            typeof connect.details_submitted === "boolean"
              ? connect.details_submitted
              : profile.stripe_details_submitted,
        };
      }
      setPayoutProfile(profile);
    } catch (e) {
      logTechnicalError("restaurant.earnings.fetchPayoutProfile", e);
      setPayoutProfile(null);
    }
  }, []);

  const fetchFinancialOverview = useCallback(async () => {
    try {
      const apiBase = String(getApiBaseUrl() ?? "").replace(/\/+$/, "").trim();
      if (!apiBase) {
        setServerPendingPayout(null);
        return;
      }

      const {
        data: { session },
        error: sessionErr,
      } = await supabase.auth.getSession();
      if (sessionErr) throw sessionErr;

      const accessToken = session?.access_token?.trim();
      if (!accessToken) {
        setServerPendingPayout(null);
        return;
      }

      const response = await fetch(
        `${apiBase}/api/restaurant/financial/overview`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok || !json?.data) {
        logTechnicalError(
          "restaurant.earnings.financial_overview",
          json?.error ?? `HTTP ${response.status}`,
        );
        setServerPendingPayout(null);
        return;
      }

      const data = json.data as {
        pendingPayout?: unknown;
      };

      const pending = Number(data.pendingPayout);
      setServerPendingPayout(Number.isFinite(pending) ? pending : null);
    } catch (e) {
      logTechnicalError("restaurant.earnings.fetchFinancialOverview", e);
      setServerPendingPayout(null);
    }
  }, []);

  const fetchEarnings = useCallback(async () => {
    if (!restaurantId) {
      setRows([]);
      setError(
        t(
          "restaurant.earnings.mustLogin",
          "Connecte-toi comme restaurant pour voir tes gains."
        )
      );
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { startISO, endISO } = monthBounds(monthFilter);

      const selectCols = [
        "id",
        "created_at",
        "status",
        "currency",
        "subtotal",
        "tax",
        "total",
        "restaurant_commission_rate",
        "restaurant_commission_amount",
        "restaurant_net_amount",
        "restaurant_paid_out",
        "restaurant_paid_out_at",
        "restaurant_transfer_id",
        "restaurant_payout_id",
        "dropoff_code_verified_at",
      ].join(",");

      const monthFilterOr = [
        `and(dropoff_code_verified_at.gte.${startISO},dropoff_code_verified_at.lt.${endISO})`,
        `and(dropoff_code_verified_at.is.null,created_at.gte.${startISO},created_at.lt.${endISO})`,
      ].join(",");

      const [{ data, error },] = await Promise.all([
        supabase
          .from("orders")
          .select(selectCols)
          .or(`restaurant_id.eq.${restaurantId},restaurant_user_id.eq.${restaurantId}`)
          .eq("status", "delivered")
          .or(monthFilterOr)
          .returns<Row[]>(),
        fetchFinancialOverview(),
      ]);

      if (error) throw error;

      const all: Row[] = data ?? [];
      all.sort((a, b) => {
        const da = getBestDate(a);
        const db = getBestDate(b);
        const ta = da ? new Date(da).getTime() : 0;
        const tb = db ? new Date(db).getTime() : 0;
        return tb - ta;
      });

      setRows(all);
    } catch (e: any) {
      console.log("RestaurantEarnings fetch error:", e);
      setRows([]);
      setError(
        e?.message ??
          t(
            "restaurant.earnings.fetchError",
            "Impossible de charger les earnings."
          )
      );
    } finally {
      setLoading(false);
    }
  }, [restaurantId, monthFilter, monthBounds, t, fetchFinancialOverview]);

  const syncRestaurantConnectStatus = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;

      const token = data.session?.access_token;
      if (!token) return;

      await supabase.functions.invoke("sync_restaurant_connect_status", {
        body: {},
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // silencieux
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await fetchEarnings();
    await syncRestaurantConnectStatus();
    await fetchPayoutProfile();
  }, [fetchEarnings, syncRestaurantConnectStatus, fetchPayoutProfile]);

  useFocusEffect(
    useCallback(() => {
      void fetchEarnings();
      void syncRestaurantConnectStatus().finally(() => {
        void fetchPayoutProfile();
      });
    }, [fetchEarnings, fetchPayoutProfile, syncRestaurantConnectStatus])
  );

  useEffect(() => {
    void fetchEarnings();
  }, [fetchEarnings]);

  const currency = useMemo(() => {
    const c = rows.find((r) => r.currency)?.currency;
    return c ?? "USD";
  }, [rows]);

  const delivered = useMemo(() => rows, [rows]);

  // Awaiting SCT = no live restaurant_transfer_id (ignore restaurant_paid_out alone).
  const unpaidDelivered = useMemo(
    () =>
      delivered.filter(
        (r) => String(r.restaurant_transfer_id ?? "").trim().length === 0,
      ),
    [delivered]
  );

  const paidDeliveredReal = useMemo(
    () =>
      delivered.filter(
        (r) => String(r.restaurant_transfer_id ?? "").trim().length > 0,
      ),
    [delivered]
  );

  // Legacy false-paid rows (restaurant_paid_out without Stripe Transfer) — never count as paid.
  const paidDeliveredManual = useMemo(
    () =>
      delivered.filter(
        (r) =>
          r.restaurant_paid_out === true &&
          !String(r.restaurant_transfer_id ?? "").trim() &&
          !String(r.restaurant_payout_id ?? "").trim(),
      ),
    [delivered]
  );

  const sum = (arr: Row[], key: keyof Row) =>
    arr.reduce((acc, r) => {
      const v = r[key];
      const n = typeof v === "number" ? v : Number(v);
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);

  const availableNet = useMemo(
    () => sum(unpaidDelivered, "restaurant_net_amount"),
    [unpaidDelivered]
  );

  const displayAvailableNet =
    serverPendingPayout != null ? serverPendingPayout : availableNet;

  const paidNet = useMemo(
    () => sum(paidDeliveredReal, "restaurant_net_amount"),
    [paidDeliveredReal]
  );

  const deliveredCount = delivered.length;
  const recentDelivered = useMemo(() => delivered.slice(0, 20), [delivered]);

  const financialSnapshot = useMemo(() => {
    const grossSales = delivered.reduce((acc, r) => {
      const total =
        r.total != null && Number.isFinite(Number(r.total))
          ? Number(r.total)
          : Number(r.subtotal ?? 0) + Number(r.tax ?? 0);
      return acc + (Number.isFinite(total) ? total : 0);
    }, 0);

    const platformCommission = delivered.reduce((acc, r) => {
      const value = Number(r.restaurant_commission_amount ?? 0);
      return acc + (Number.isFinite(value) ? value : 0);
    }, 0);

    const restaurantNet = delivered.reduce((acc, r) => {
      const value = Number(r.restaurant_net_amount ?? 0);
      return acc + (Number.isFinite(value) ? value : 0);
    }, 0);

    return {
      grossSales,
      platformCommission,
      restaurantNet,
      totalOrders: delivered.length,
    };
  }, [delivered]);

  const monthSummary = useMemo(() => {
    const totalNet = sum(delivered, "restaurant_net_amount");
    const avgNet = delivered.length > 0 ? totalNet / delivered.length : 0;

    const totalsByDay = new Map<string, number>();
    for (const r of delivered) {
      const iso = getBestDate(r) ?? r.created_at;
      if (!iso) continue;

      const d = new Date(iso);
      const dayKey = d.toISOString().slice(0, 10);
      const net = Number(r.restaurant_net_amount ?? 0);
      totalsByDay.set(dayKey, (totalsByDay.get(dayKey) ?? 0) + net);
    }

    const bounds = monthBounds(monthFilter);
    const endRef =
      monthFilter === "this_month" ? new Date() : new Date(bounds.endISO);

    const endUTC = new Date(
      Date.UTC(
        endRef.getUTCFullYear(),
        endRef.getUTCMonth(),
        endRef.getUTCDate()
      )
    );

    const take: { key: string; label: string; total: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(endUTC);
      d.setUTCDate(d.getUTCDate() - i);

      const key = d.toISOString().slice(0, 10);
      const label = d
        .toLocaleDateString(locale, { weekday: "short" })
        .replace(".", "");

      const total = totalsByDay.get(key) ?? 0;
      take.push({ key, label, total });
    }

    const values = take.map((x) => Number(x.total ?? 0));
    const max = Math.max(1, ...values);

    const bars = take.map((x) => {
      const v = Number(x.total ?? 0);
      const pct = clamp(v / max, 0, 1);
      return { key: x.key, value: v, pct, label: x.label };
    });

    return { totalNet, avgNet, bars };
  }, [delivered, monthFilter, locale, monthBounds]);

  useEffect(() => {
    barAnim.setValue(0);
    Animated.timing(barAnim, {
      toValue: 1,
      duration: 450,
      useNativeDriver: false,
    }).start();
  }, [barAnim, monthSummary.bars]);

  // Intentionally removed: client must never mark restaurant_paid_out without a Stripe Transfer.
  // Wallet / earnings SoT is restaurant_transfer_id (server transfers/run + webhooks).

  const payoutStatus = useMemo(() => {
    const code = deriveRestaurantConnectStatus(payoutProfile);
    return {
      code,
      label: stripeConnectStatusLabel(code),
      message: stripeConnectUserMessage(code),
      ok: code === "ready_for_payouts",
    };
  }, [payoutProfile]);

  const debugCopyJwt = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;

      const token = data.session?.access_token;
      if (!token) {
        Alert.alert(
          t("common.info", "Info"),
          t(
            "restaurant.earnings.debug.noSession",
            "Pas de session. Reconnecte-toi d'abord."
          )
        );
        return;
      }

      await Clipboard.setStringAsync(token);

      Alert.alert(
        t("restaurant.earnings.debug.copiedTitle", "Token copié ✅"),
        t("restaurant.earnings.debug.copiedBody", "Début: {{a}}...\nFin: ...{{b}}", {
          a: token.slice(0, 18),
          b: token.slice(-10),
        })
      );
    } catch (e: any) {
      Alert.alert(
        t("common.error", "Erreur"),
        e?.message ??
          t(
            "restaurant.earnings.debug.fail",
            "Impossible de récupérer la session."
          )
      );
    }
  }, [t]);

  const periodStats = useMemo(() => {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = startToday.getDay();
    const mondayOffset = day === 0 ? 6 : day - 1;
    const startWeek = new Date(startToday);
    startWeek.setDate(startWeek.getDate() - mondayOffset);
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const inRange = (r: Row, start: Date) => {
      const iso = getBestDate(r);
      if (!iso) return false;
      const d = new Date(iso);
      return d.getTime() >= start.getTime();
    };

    const sumNet = (list: Row[]) =>
      list.reduce((acc, r) => {
        const n = Number(r.restaurant_net_amount ?? 0);
        return acc + (Number.isFinite(n) ? n : 0);
      }, 0);

    const todayRows = delivered.filter((r) => inRange(r, startToday));
    const weekRows = delivered.filter((r) => inRange(r, startWeek));
    const monthRows = delivered.filter((r) => inRange(r, startMonth));

    return {
      todayNet: sumNet(todayRows),
      todayCount: todayRows.length,
      weekNet: sumNet(weekRows),
      monthNet: sumNet(monthRows),
    };
  }, [delivered]);

  const fmtUsd = useCallback(
    (n: number) => {
      try {
        return new Intl.NumberFormat(locale, {
          style: "currency",
          currency: currency || "USD",
          maximumFractionDigits: 2,
        }).format(n);
      } catch {
        return money(n, currency);
      }
    },
    [locale, currency, money]
  );

  if (initialLoad && loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
        <ScreenHeader
          title={t("restaurant.earnings.header.title", "Earnings")}
          subtitle="💰"
          fallbackRoute="RestaurantCommandCenter"
          variant="mmd"
        />
        <RestaurantBrandLoadingState
          glass
          title={t("restaurant.earnings.loadingTitle", "Loading Earnings...")}
          subtitle={t(
            "restaurant.earnings.loadingSubtitle",
            "Fetching your revenue data"
          )}
        />
      </SafeAreaView>
    );
  }

  if (error && !loading && rows.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
        <ScreenHeader
          title={t("restaurant.earnings.header.title", "Earnings")}
          subtitle="💰"
          fallbackRoute="RestaurantCommandCenter"
          variant="mmd"
        />
        <View style={styles.centered}>
          <View style={styles.glassCard}>
            <Text style={styles.emoji}>❌</Text>
            <Text style={styles.cardTitle}>
              {t("restaurant.earnings.errorTitle", "Unable to Load")}
            </Text>
            <Text style={styles.cardBody}>
              {error ||
                t(
                  "restaurant.earnings.errorBody",
                  "Could not load earnings. Please try again."
                )}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.cta}
            onPress={() => void refreshAll()}
            accessibilityRole="button"
          >
            <Text style={styles.ctaLabel}>{t("common.retry", "Retry")}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={t("restaurant.earnings.header.title", "Earnings")}
        subtitle="💰"
        fallbackRoute="RestaurantCommandCenter"
        variant="mmd"
        rightSlot={
          <TouchableOpacity
            onPress={() => void refreshAll()}
            style={styles.refreshBtn}
            accessibilityRole="button"
          >
            <Text style={styles.refreshText}>
              {loading
                ? t("common.ellipsis", "…")
                : t("common.refresh", "Refresh")}
            </Text>
          </TouchableOpacity>
        }
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <RestaurantStripeConnectCard
          heldAmountLabel={
            !payoutStatus.ok && displayAvailableNet > 0
              ? fmtUsd(displayAvailableNet)
              : null
          }
        />

        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>
            {t("restaurant.earnings.today", "Today")}
          </Text>
          <Text style={styles.heroAmount}>{fmtUsd(periodStats.todayNet)}</Text>
          <Text style={styles.heroFoot}>
            {payoutStatus.ok
              ? t(
                  "restaurant.earnings.todayMetaReady",
                  "{{n}} orders • payouts enabled",
                  { n: periodStats.todayCount },
                )
              : t(
                  "restaurant.earnings.todayMetaBlocked",
                  "{{n}} orders • payouts blocked until Stripe Connect",
                  { n: periodStats.todayCount },
                )}
          </Text>
        </View>

        <View style={styles.grid}>
          <View style={styles.halfCard}>
            <Text style={styles.halfLabel}>
              {t("restaurant.earnings.thisWeek", "This Week")}
            </Text>
            <Text style={styles.halfAmount}>{fmtUsd(periodStats.weekNet)}</Text>
          </View>
          <View style={styles.halfCard}>
            <Text style={styles.halfLabel}>
              {t("restaurant.earnings.thisMonth", "This Month")}
            </Text>
            <Text style={styles.halfAmount}>{fmtUsd(periodStats.monthNet)}</Text>
          </View>
        </View>

        <Text style={styles.section}>
          📋 {t("restaurant.earnings.recentOrders", "Recent Orders")}
        </Text>
        {recentDelivered.length === 0 ? (
          <Text style={styles.empty}>
            {t(
              "restaurant.earnings.list.empty",
              "Aucune commande livrée pour le moment."
            )}
          </Text>
        ) : (
          recentDelivered.slice(0, 10).map((r) => (
            <TouchableOpacity
              key={r.id}
              activeOpacity={0.85}
              onPress={() =>
                navigation.navigate("RestaurantOrderDetails", { orderId: r.id })
              }
              style={styles.orderRow}
            >
              <Text style={styles.orderId}>
                #{String(r.id).slice(0, 4).toUpperCase()}
              </Text>
              <Text style={styles.orderAmt}>
                {fmtUsd(Number(r.restaurant_net_amount ?? 0))}
              </Text>
            </TouchableOpacity>
          ))
        )}

        {IS_DEV ? (
          <TouchableOpacity onPress={() => void debugCopyJwt()} style={styles.devBtn}>
            <Text style={styles.devText}>DEV: copy JWT</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 24,
  },
  stripeBody: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 40,
    gap: 24,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 12,
  },
  glassCard: {
    width: 320,
    maxWidth: "100%",
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
    gap: 24,
  },
  stripeCard: {
    width: "100%",
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 20,
    padding: 24,
    gap: 16,
  },
  emoji: { fontSize: 40, color: MMD_WHITE },
  cardTitle: {
    color: MMD_TEXT,
    fontSize: 20,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    textAlign: "center",
  },
  cardBody: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
    textAlign: "center",
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(245,158,11,0.2)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  badgeText: {
    color: "#F59E0B",
    fontSize: 12,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  cta: {
    backgroundColor: MMD_TAXI_GREEN,
    minHeight: 44,
    paddingHorizontal: 48,
    paddingVertical: 14,
    borderRadius: 14,
  },
  ctaFull: {
    backgroundColor: MMD_TAXI_GREEN,
    minHeight: 44,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaLabel: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  refreshBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  refreshText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 12,
  },
  heroCard: {
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 20,
    padding: 24,
    gap: 8,
  },
  heroLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
  },
  heroAmount: {
    color: MMD_WHITE,
    fontSize: 32,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  heroFoot: {
    color: MMD_TAXI_GREEN,
    fontSize: 14,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  grid: { flexDirection: "row", gap: 12 },
  halfCard: {
    flex: 1,
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 16,
    padding: 16,
    gap: 4,
  },
  halfLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
  },
  halfAmount: {
    color: MMD_WHITE,
    fontSize: 22,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  section: {
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    marginTop: 4,
  },
  empty: {
    color: "rgba(255,255,255,0.7)",
    fontFamily: MMD_FONT.regular,
    fontSize: 14,
  },
  orderRow: {
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  orderId: {
    color: MMD_WHITE,
    fontSize: 15,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  orderAmt: {
    color: MMD_TAXI_GREEN,
    fontSize: 15,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  devBtn: { marginTop: 16, alignSelf: "flex-start" },
  devText: { color: "rgba(255,255,255,0.5)", fontSize: 12 },
});

export default RestaurantEarningsScreen;
