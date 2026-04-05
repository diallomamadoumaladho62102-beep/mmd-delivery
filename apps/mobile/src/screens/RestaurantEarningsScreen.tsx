// apps/mobile/src/screens/RestaurantEarningsScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  SafeAreaView,
  View,
  Text,
  StatusBar,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import * as Linking from "expo-linking";
import * as Clipboard from "expo-clipboard";
import { supabase } from "../lib/supabase";

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

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function getBestDate(r: Row) {
  return r.dropoff_code_verified_at ?? r.created_at ?? null;
}

export function RestaurantEarningsScreen() {
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation();

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [payoutLoading, setPayoutLoading] = useState(false);
  const [payoutProfile, setPayoutProfile] =
    useState<RestaurantPayoutProfile | null>(null);

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
        if (!cancelled) setRestaurantId(uid);
      } catch (e: any) {
        console.log("getUser error:", e?.message ?? e);
        if (!cancelled) setRestaurantId(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const doLogout = useCallback(async () => {
    Alert.alert(
      t("restaurant.earnings.logout.title", "Se déconnecter"),
      t("restaurant.earnings.logout.body", "Tu veux vraiment te déconnecter ?"),
      [
        { text: t("common.cancel", "Annuler"), style: "cancel" },
        {
          text: t("common.yes", "Oui"),
          style: "destructive",
          onPress: async () => {
            try {
              setLoading(true);
              const { error } = await supabase.auth.signOut();
              if (error) throw error;

              setRows([]);
              setError(null);
              setRestaurantId(null);
              setPayoutProfile(null);

              navigation.reset({
                index: 0,
                routes: [{ name: "RestaurantAuth" }],
              });
            } catch (e: any) {
              Alert.alert(
                t("common.error", "Erreur"),
                e?.message ??
                  t(
                    "restaurant.earnings.logout.error",
                    "Impossible de se déconnecter."
                  )
              );
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  }, [navigation, t]);

  const fetchPayoutProfile = useCallback(async () => {
    try {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();

      if (userErr) throw userErr;
      if (!user) {
        setPayoutProfile(null);
        return;
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
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;
      setPayoutProfile((data as any) ?? null);
    } catch {
      setPayoutProfile(null);
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

      const { data, error } = await supabase
        .from("orders")
        .select(selectCols)
        .eq("restaurant_id", restaurantId)
        .eq("status", "delivered")
        .or(monthFilterOr)
        .returns<Row[]>();

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
  }, [restaurantId, monthFilter, monthBounds, t]);

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

  const unpaidDelivered = useMemo(
    () =>
      delivered.filter(
        (r) => r.restaurant_paid_out == null || r.restaurant_paid_out === false
      ),
    [delivered]
  );

  const paidDeliveredReal = useMemo(
    () =>
      delivered.filter(
        (r) =>
          r.restaurant_paid_out === true &&
          (!!r.restaurant_transfer_id || !!r.restaurant_payout_id)
      ),
    [delivered]
  );

  const paidDeliveredManual = useMemo(
    () =>
      delivered.filter(
        (r) =>
          r.restaurant_paid_out === true &&
          !r.restaurant_transfer_id &&
          !r.restaurant_payout_id
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

  const markOrderPaid = useCallback(
    async (orderId: string) => {
      if (!restaurantId)
        throw new Error(
          t("restaurant.earnings.errors.notConnected", "Restaurant non connecté.")
        );

      const now = new Date().toISOString();

      const { error } = await supabase
        .from("orders")
        .update({
          restaurant_paid_out: true,
          restaurant_paid_out_at: now,
        })
        .eq("id", orderId)
        .eq("restaurant_id", restaurantId)
        .eq("status", "delivered")
        .or("restaurant_paid_out.is.null,restaurant_paid_out.eq.false");

      if (error) throw error;
    },
    [restaurantId, t]
  );

  const payoutStatus = useMemo(() => {
    if (!payoutProfile?.stripe_account_id)
      return {
        label: t("restaurant.earnings.payout.notConfigured", "Non configuré"),
        ok: false,
      };

    if (payoutProfile.stripe_payouts_enabled)
      return { label: t("restaurant.earnings.payout.active", "Actif"), ok: true };

    return {
      label: t("restaurant.earnings.payout.configuring", "En configuration"),
      ok: false,
    };
  }, [payoutProfile, t]);

  async function startStripeOnboarding() {
    if (payoutLoading) return;

    try {
      if (payoutProfile?.stripe_payouts_enabled) {
        Alert.alert(
          t("common.info", "Info"),
          t(
            "restaurant.earnings.payout.alreadyActive",
            "Ton virement est déjà actif ✅"
          )
        );
        return;
      }

      setPayoutLoading(true);

      const { data: sessionData, error: sessionErr } =
        await supabase.auth.getSession();
      if (sessionErr) throw sessionErr;

      const token = sessionData.session?.access_token;
      if (!token)
        throw new Error(
          t(
            "restaurant.earnings.errors.missingSession",
            "Session manquante. Reconnecte-toi puis réessaie."
          )
        );

      const returnUrl = Linking.createURL("stripe/return");
      const refreshUrl = Linking.createURL("stripe/refresh");

      const { data, error } = await supabase.functions.invoke(
        "restaurant-connect-link",
        {
          body: { return_url: returnUrl, refresh_url: refreshUrl },
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (error) {
        const anyErr: any = error;
        const body = anyErr?.context?.body;

        const msg = body
          ? typeof body === "string"
            ? body
            : JSON.stringify(body, null, 2)
          : error.message;

        throw new Error(msg);
      }

      const url = (data as any)?.url as string | undefined;
      if (!url)
        throw new Error(
          t("restaurant.earnings.errors.missingStripeLink", "Lien Stripe manquant.")
        );

      await Linking.openURL(url);
    } catch (e: any) {
      Alert.alert(
        t("common.error", "Erreur"),
        e?.message ??
          t(
            "restaurant.earnings.errors.openStripe",
            "Impossible d’ouvrir Stripe Connect."
          )
      );
    } finally {
      setPayoutLoading(false);
    }
  }

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

  const monthUi = useMemo(() => {
    const a = monthBounds("this_month");
    const b = monthBounds("prev_month");
    return { a, b };
  }, [monthBounds]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#111827" }}>
      <StatusBar barStyle="light-content" />

      <View style={{ padding: 16, paddingBottom: 10 }}>
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
            <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
              {t("common.backArrow", "←")}
            </Text>
          </TouchableOpacity>

          <View style={{ alignItems: "center" }}>
            <Text style={{ color: "white", fontWeight: "900", fontSize: 16 }}>
              {t("restaurant.earnings.header.title", "Earnings")}
            </Text>
            <Text style={{ color: "#9CA3AF", fontWeight: "800", fontSize: 12 }}>
              {t("restaurant.earnings.header.subtitle", "Restaurant")}
            </Text>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TouchableOpacity
              onPress={() => {
                void refreshAll();
              }}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 999,
                backgroundColor: "rgba(15,23,42,0.7)",
                borderWidth: 1,
                borderColor: "#1F2937",
              }}
            >
              <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
                {loading
                  ? t("common.ellipsis", "...")
                  : t("common.refresh", "Rafraîchir")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => void doLogout()}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 999,
                backgroundColor: "rgba(239,68,68,0.12)",
                borderWidth: 1,
                borderColor: "#7F1D1D",
              }}
            >
              <Text style={{ color: "#FCA5A5", fontWeight: "900" }}>
                {t("common.logout", "Déconnexion")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {error ? (
          <Text style={{ color: "#F97373", marginTop: 10, fontWeight: "800" }}>
            {error}
          </Text>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {loading || payoutLoading ? (
          <View
            style={{
              marginTop: 10,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
            }}
          >
            <ActivityIndicator />
            <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
              {loading
                ? t("common.loading", "Chargement…")
                : t("restaurant.earnings.loading.openStripe", "Ouverture Stripe…")}
            </Text>
          </View>
        ) : null}

        {/* ✅ FINANCIAL SNAPSHOT */}
        <View
          style={{
            backgroundColor: "#020617",
            borderRadius: 16,
            padding: 14,
            borderWidth: 1,
            borderColor: "#1F2937",
            marginBottom: 12,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: "white", fontWeight: "900", fontSize: 16 }}>
                {t("restaurant.earnings.financial.title", "Financial snapshot")}
              </Text>
              <Text
                style={{
                  color: "#64748B",
                  marginTop: 6,
                  fontWeight: "800",
                }}
              >
                {monthFilter === "this_month" ? monthUi.a.label : monthUi.b.label}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => navigation.navigate("RestaurantTax")}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: "#1D4ED8",
                backgroundColor: "rgba(59,130,246,0.12)",
              }}
            >
              <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
                {t("restaurant.earnings.financial.taxCenter", "Open Tax Center")}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            <View
              style={{
                flex: 1,
                backgroundColor: "rgba(15,23,42,0.65)",
                borderRadius: 14,
                padding: 12,
                borderWidth: 1,
                borderColor: "#1F2937",
              }}
            >
              <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
                {t("restaurant.earnings.financial.grossSales", "Gross sales")}
              </Text>
              <Text
                style={{
                  color: "#E5E7EB",
                  fontWeight: "900",
                  fontSize: 18,
                  marginTop: 6,
                }}
              >
                {money(financialSnapshot.grossSales, currency)}
              </Text>
            </View>

            <View
              style={{
                flex: 1,
                backgroundColor: "rgba(15,23,42,0.65)",
                borderRadius: 14,
                padding: 12,
                borderWidth: 1,
                borderColor: "#1F2937",
              }}
            >
              <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
                {t("restaurant.earnings.financial.commission", "Commission")}
              </Text>
              <Text
                style={{
                  color: "#FCA5A5",
                  fontWeight: "900",
                  fontSize: 18,
                  marginTop: 6,
                }}
              >
                {money(financialSnapshot.platformCommission, currency)}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <View
              style={{
                flex: 1,
                backgroundColor: "rgba(15,23,42,0.65)",
                borderRadius: 14,
                padding: 12,
                borderWidth: 1,
                borderColor: "#1F2937",
              }}
            >
              <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
                {t("restaurant.earnings.financial.net", "Restaurant net")}
              </Text>
              <Text
                style={{
                  color: "#22C55E",
                  fontWeight: "900",
                  fontSize: 18,
                  marginTop: 6,
                }}
              >
                {money(financialSnapshot.restaurantNet, currency)}
              </Text>
            </View>

            <View
              style={{
                flex: 1,
                backgroundColor: "rgba(15,23,42,0.65)",
                borderRadius: 14,
                padding: 12,
                borderWidth: 1,
                borderColor: "#1F2937",
              }}
            >
              <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
                {t("restaurant.earnings.financial.orders", "Total orders")}
              </Text>
              <Text
                style={{
                  color: "#E5E7EB",
                  fontWeight: "900",
                  fontSize: 18,
                  marginTop: 6,
                }}
              >
                {financialSnapshot.totalOrders}
              </Text>
            </View>
          </View>
        </View>

        {/* ✅ HISTORIQUE MENSUEL */}
        <View
          style={{
            backgroundColor: "#020617",
            borderRadius: 16,
            padding: 14,
            borderWidth: 1,
            borderColor: "#1F2937",
            marginBottom: 12,
          }}
        >
          <Text style={{ color: "white", fontWeight: "900", fontSize: 16 }}>
            {t("restaurant.earnings.monthly.title", "Historique mensuel")}
          </Text>
          <Text style={{ color: "#64748B", marginTop: 6, fontWeight: "800" }}>
            {monthFilter === "this_month" ? monthUi.a.short : monthUi.b.short}
          </Text>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            <TouchableOpacity
              onPress={() => setMonthFilter("this_month")}
              style={{
                flex: 1,
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderRadius: 999,
                borderWidth: 1,
                borderColor:
                  monthFilter === "this_month" ? "#2563EB" : "#1F2937",
                backgroundColor:
                  monthFilter === "this_month"
                    ? "rgba(59,130,246,0.18)"
                    : "rgba(15,23,42,0.65)",
                alignItems: "center",
              }}
            >
              <Text style={{ color: "white", fontWeight: "900" }}>
                {t("restaurant.earnings.filters.thisMonth", "Ce mois")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setMonthFilter("prev_month")}
              style={{
                flex: 1,
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderRadius: 999,
                borderWidth: 1,
                borderColor:
                  monthFilter === "prev_month" ? "#2563EB" : "#1F2937",
                backgroundColor:
                  monthFilter === "prev_month"
                    ? "rgba(59,130,246,0.18)"
                    : "rgba(15,23,42,0.65)",
                alignItems: "center",
              }}
            >
              <Text style={{ color: "white", fontWeight: "900" }}>
                {t("restaurant.earnings.filters.prevMonth", "Mois précédent")}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            <View
              style={{
                flex: 1,
                backgroundColor: "rgba(15,23,42,0.65)",
                borderRadius: 14,
                padding: 12,
                borderWidth: 1,
                borderColor: "#1F2937",
              }}
            >
              <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
                {t("restaurant.earnings.monthly.totalNet", "Net total")}
              </Text>
              <Text
                style={{
                  color: "#22C55E",
                  fontWeight: "900",
                  fontSize: 18,
                  marginTop: 6,
                }}
              >
                {money(monthSummary.totalNet, currency)}
              </Text>
            </View>

            <View
              style={{
                flex: 1,
                backgroundColor: "rgba(15,23,42,0.65)",
                borderRadius: 14,
                padding: 12,
                borderWidth: 1,
                borderColor: "#1F2937",
              }}
            >
              <Text
                numberOfLines={1}
                style={{ color: "#9CA3AF", fontWeight: "900" }}
              >
                {t("restaurant.earnings.monthly.ordersShort", "Cmds")}
              </Text>
              <Text
                style={{
                  color: "#E5E7EB",
                  fontWeight: "900",
                  fontSize: 18,
                  marginTop: 6,
                }}
              >
                {delivered.length}
              </Text>
            </View>

            <View
              style={{
                flex: 1,
                backgroundColor: "rgba(15,23,42,0.65)",
                borderRadius: 14,
                padding: 12,
                borderWidth: 1,
                borderColor: "#1F2937",
              }}
            >
              <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
                {t("restaurant.earnings.monthly.avgNet", "Net moyen")}
              </Text>
              <Text
                style={{
                  color: "#93C5FD",
                  fontWeight: "900",
                  fontSize: 18,
                  marginTop: 6,
                }}
              >
                {money(monthSummary.avgNet, currency)}
              </Text>
            </View>
          </View>

          <View
            style={{
              marginTop: 12,
              backgroundColor: "rgba(15,23,42,0.65)",
              borderRadius: 14,
              padding: 12,
              borderWidth: 1,
              borderColor: "#1F2937",
            }}
          >
            <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
              {t("restaurant.earnings.monthly.activity", "Activité (6 dernières)")}
            </Text>

            {monthSummary.bars.length === 0 ? (
              <Text style={{ color: "#64748B", marginTop: 8, fontWeight: "800" }}>
                {t("restaurant.earnings.monthly.none", "Aucune livraison sur la période.")}
              </Text>
            ) : (
              <View
                style={{
                  flexDirection: "row",
                  gap: 10,
                  marginTop: 10,
                  alignItems: "flex-end",
                }}
              >
                {monthSummary.bars.map((b) => {
                  const h = 64;
                  const barH = Math.round(h * b.pct);

                  return (
                    <View key={b.key} style={{ flex: 1, alignItems: "center" }}>
                      <View
                        style={{
                          width: "100%",
                          height: h,
                          justifyContent: "flex-end",
                          borderRadius: 10,
                          overflow: "hidden",
                          backgroundColor: "rgba(2,6,23,0.6)",
                          borderWidth: 1,
                          borderColor: "#111827",
                        }}
                      >
                        <Animated.View
                          style={{
                            height: barAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0, barH],
                            }),
                            borderRadius: 10,
                            backgroundColor: "rgba(59,130,246,0.55)",
                            borderWidth: 1,
                            borderColor: "rgba(59,130,246,0.9)",
                          }}
                        />
                      </View>

                      <Text
                        style={{
                          color: "#64748B",
                          fontWeight: "900",
                          fontSize: 11,
                          marginTop: 6,
                        }}
                      >
                        {b.label}
                      </Text>

                      <Text
                        style={{
                          color: "#9CA3AF",
                          fontWeight: "800",
                          fontSize: 11,
                          marginTop: 2,
                        }}
                      >
                        {Number.isFinite(b.value) ? b.value.toFixed(0) : "0"}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </View>

        {/* ✅ PAIEMENTS */}
        <View
          style={{
            backgroundColor: "#020617",
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
            borderColor: "#1F2937",
            marginBottom: 12,
          }}
        >
          <Text style={{ color: "white", fontWeight: "900", fontSize: 16 }}>
            {t("restaurant.earnings.payments.title", "Paiements")}
          </Text>

          <Text style={{ color: "#9CA3AF", marginTop: 8, fontWeight: "800" }}>
            {t("restaurant.earnings.payments.statusLabel", "Statut virement :")}{" "}
            <Text
              style={{
                color: payoutStatus.ok ? "#22C55E" : "#EAB308",
                fontWeight: "900",
              }}
            >
              {payoutStatus.label}
            </Text>
          </Text>

          <Text style={{ color: "#64748B", marginTop: 8, fontWeight: "800" }}>
            {t(
              "restaurant.earnings.payments.help",
              "Configure ton compte Stripe pour recevoir les virements (Express)."
            )}
          </Text>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            <TouchableOpacity
              onPress={() => void startStripeOnboarding()}
              style={{
                alignSelf: "flex-start",
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: "#1F2937",
                backgroundColor: "rgba(59,130,246,0.12)",
              }}
            >
              <Text style={{ color: "white", fontWeight: "900" }}>
                {t("restaurant.earnings.payments.setup", "Configurer mon virement")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => navigation.navigate("RestaurantMenu")}
              style={{
                alignSelf: "flex-start",
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: "#1F2937",
                backgroundColor: "rgba(96,165,250,0.12)",
              }}
            >
              <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
                {t("restaurant.earnings.payments.editMenu", "Modifier le menu")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* KPI CARDS */}
        <View style={{ gap: 12 }}>
          <View
            style={{
              backgroundColor: "#020617",
              borderRadius: 16,
              padding: 16,
              borderWidth: 1,
              borderColor: "#1F2937",
            }}
          >
            <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
              {t("restaurant.earnings.kpi.available.title", "Disponible (non payé)")}
            </Text>
            <Text
              style={{
                color: "#22C55E",
                fontWeight: "900",
                fontSize: 26,
                marginTop: 6,
              }}
            >
              {money(availableNet, currency)}
            </Text>
            <Text style={{ color: "#64748B", marginTop: 6, fontWeight: "800" }}>
              {t(
                "restaurant.earnings.kpi.available.subtitle",
                "Basé sur {{n}} commande(s) livrée(s) non payée(s)",
                { n: unpaidDelivered.length }
              )}
            </Text>
          </View>

          <View
            style={{
              backgroundColor: "#020617",
              borderRadius: 16,
              padding: 16,
              borderWidth: 1,
              borderColor: "#1F2937",
            }}
          >
            <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
              {t("restaurant.earnings.kpi.paid.title", "Payé (Stripe payout)")}
            </Text>
            <Text
              style={{
                color: "#E5E7EB",
                fontWeight: "900",
                fontSize: 24,
                marginTop: 6,
              }}
            >
              {money(paidNet, currency)}
            </Text>
            <Text style={{ color: "#64748B", marginTop: 6, fontWeight: "800" }}>
              {paidDeliveredManual.length > 0
                ? t(
                    "restaurant.earnings.kpi.paid.subtitleWithManual",
                    "Basé sur {{n}} commande(s) payée(s) (+{{m}} marquée(s) payée(s) sans transfert)",
                    { n: paidDeliveredReal.length, m: paidDeliveredManual.length }
                  )
                : t(
                    "restaurant.earnings.kpi.paid.subtitle",
                    "Basé sur {{n}} commande(s) payée(s)",
                    { n: paidDeliveredReal.length }
                  )}
            </Text>
          </View>

          <View
            style={{
              backgroundColor: "#020617",
              borderRadius: 16,
              padding: 16,
              borderWidth: 1,
              borderColor: "#1F2937",
            }}
          >
            <Text style={{ color: "#9CA3AF", fontWeight: "900" }}>
              {t("restaurant.earnings.kpi.delivered.title", "Commandes livrées")}
            </Text>
            <Text
              style={{
                color: "#E5E7EB",
                fontWeight: "900",
                fontSize: 22,
                marginTop: 6,
              }}
            >
              {deliveredCount}
            </Text>
          </View>
        </View>

        {/* LIST */}
        <View style={{ marginTop: 18 }}>
          <Text
            style={{
              color: "white",
              fontWeight: "900",
              fontSize: 18,
              marginBottom: 10,
            }}
          >
            {t("restaurant.earnings.list.title", "Dernières livraisons")}
          </Text>

          {recentDelivered.length === 0 ? (
            <Text style={{ color: "#9CA3AF" }}>
              {t("restaurant.earnings.list.empty", "Aucune commande livrée pour le moment.")}
            </Text>
          ) : (
            <View style={{ gap: 10 }}>
              {recentDelivered.map((r) => {
                const commissionRate = r.restaurant_commission_rate;
                const commissionAmt = r.restaurant_commission_amount;
                const net = r.restaurant_net_amount;

                const isPaid = r.restaurant_paid_out === true;
                const isStripePaid =
                  isPaid && (!!r.restaurant_transfer_id || !!r.restaurant_payout_id);
                const isManualPaid =
                  isPaid && !r.restaurant_transfer_id && !r.restaurant_payout_id;

                const isUnpaid = !isPaid;

                const pillBg = isStripePaid
                  ? "rgba(34,197,94,0.12)"
                  : isManualPaid
                  ? "rgba(234,179,8,0.12)"
                  : "rgba(59,130,246,0.12)";

                const pillBorder = isStripePaid
                  ? "#14532D"
                  : isManualPaid
                  ? "#92400E"
                  : "#1D4ED8";

                const pillText = isStripePaid
                  ? t("restaurant.earnings.pill.paid", "Payé")
                  : isManualPaid
                  ? t("restaurant.earnings.pill.markedPaid", "Marqué payé")
                  : t("restaurant.earnings.pill.available", "Disponible");

                const pillColor = isStripePaid
                  ? "#BBF7D0"
                  : isManualPaid
                  ? "#FDE68A"
                  : "#BFDBFE";

                const shownDate = getBestDate(r);

                return (
                  <TouchableOpacity
                    key={r.id}
                    activeOpacity={0.8}
                    onPress={() =>
                      navigation.navigate("RestaurantOrderDetails", {
                        orderId: r.id,
                      })
                    }
                    style={{
                      backgroundColor: "rgba(15,23,42,0.65)",
                      borderRadius: 16,
                      padding: 14,
                      borderWidth: 1,
                      borderColor: "#1F2937",
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                      }}
                    >
                      <View style={{ flex: 1, paddingRight: 10 }}>
                        <Text
                          style={{
                            color: "#E5E7EB",
                            fontWeight: "900",
                            fontSize: 16,
                          }}
                        >
                          {t("restaurant.earnings.order.title", "Commande #{{id}}", {
                            id: r.id.slice(0, 8),
                          })}
                        </Text>
                        <Text
                          style={{
                            color: "#64748B",
                            marginTop: 4,
                            fontWeight: "800",
                          }}
                        >
                          {fmtDateTime(shownDate)}
                        </Text>
                      </View>

                      <View
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 999,
                          backgroundColor: pillBg,
                          borderWidth: 1,
                          borderColor: pillBorder,
                        }}
                      >
                        <Text
                          style={{
                            color: pillColor,
                            fontWeight: "900",
                            fontSize: 12,
                          }}
                        >
                          {pillText}
                        </Text>
                      </View>
                    </View>

                    <View style={{ marginTop: 10 }}>
                      <Text style={{ color: "#9CA3AF", fontWeight: "800" }}>
                        {t("restaurant.earnings.order.subtotalTaxes", "Subtotal + taxes :")}{" "}
                        <Text style={{ color: "#E5E7EB" }}>
                          {money((r.subtotal ?? 0) + (r.tax ?? 0), currency)}
                        </Text>
                      </Text>

                      <Text
                        style={{
                          color: "#9CA3AF",
                          fontWeight: "800",
                          marginTop: 6,
                        }}
                      >
                        {t("restaurant.earnings.order.commission", "Commission :")}{" "}
                        <Text style={{ color: "#FCA5A5", fontWeight: "900" }}>
                          {money(commissionAmt, currency)}
                        </Text>{" "}
                        {commissionRate != null ? (
                          <Text style={{ color: "#64748B" }}>
                            ({Math.round(Number(commissionRate) * 100)}%)
                          </Text>
                        ) : null}
                      </Text>

                      <Text
                        style={{
                          color: "#9CA3AF",
                          fontWeight: "800",
                          marginTop: 6,
                        }}
                      >
                        {t("restaurant.earnings.order.net", "Net restaurant :")}{" "}
                        <Text style={{ color: "#22C55E", fontWeight: "900" }}>
                          {money(net, currency)}
                        </Text>
                      </Text>

                      {isUnpaid && (
                        <TouchableOpacity
                          onPress={() => {
                            Alert.alert(
                              t("restaurant.earnings.markPaid.title", "Marquer comme payé"),
                              t(
                                "restaurant.earnings.markPaid.body",
                                "Confirmer le payout (mode test) ? (Sans transfert Stripe)"
                              ),
                              [
                                { text: t("common.cancel", "Annuler"), style: "cancel" },
                                {
                                  text: t("restaurant.earnings.markPaid.confirm", "Oui, marqué payé"),
                                  style: "destructive",
                                  onPress: async () => {
                                    try {
                                      await markOrderPaid(r.id);
                                      await fetchEarnings();
                                    } catch (e: any) {
                                      Alert.alert(
                                        t("common.error", "Erreur"),
                                        e?.message ??
                                          t(
                                            "restaurant.earnings.markPaid.fail",
                                            "Update impossible."
                                          )
                                      );
                                    }
                                  },
                                },
                              ]
                            );
                          }}
                          style={{
                            marginTop: 10,
                            alignSelf: "flex-start",
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                            borderRadius: 999,
                            borderWidth: 1,
                            borderColor: "#1F2937",
                            backgroundColor: "rgba(15,23,42,0.7)",
                          }}
                        >
                          <Text
                            style={{
                              color: "white",
                              fontWeight: "900",
                              fontSize: 12,
                            }}
                          >
                            {t("restaurant.earnings.markPaid.button", "Marquer comme payé")}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}