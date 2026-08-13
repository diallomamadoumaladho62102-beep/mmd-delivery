import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { toUserFacingError } from "../lib/userFacingError";
import {
  fetchMmdPlusSummary,
  mmdPlusAction,
  type MmdPlusCurrent,
  type MmdPlusInvoice,
  type MmdPlusPlan,
} from "../lib/mmdPlusApi";
import type { RootStackParamList } from "../navigation/AppNavigator";
import {
  MMD_BLUE,
  MMD_CARD_ON_BLUE_STRONG,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_STROKE,
  MMD_TEXT,
  MMD_TEXT_MUTED_BLUE,
  MMD_TEXT_SOFT_BLUE,
  MMD_WHITE,
} from "../theme/mmdUi";

type Nav = NativeStackNavigationProp<RootStackParamList, "MmdPlus">;

const MMD_LOGO = require("../../assets/brand/mmd-logo-ui.png");

function formatMoney(cents: number, currency: string) {
  return `${(Math.max(0, cents) / 100).toFixed(2)} ${currency || "USD"}`;
}

export default function MmdPlusScreen() {
  const navigation = useNavigation<Nav>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<MmdPlusCurrent | null>(null);
  const [plans, setPlans] = useState<MmdPlusPlan[]>([]);
  const [invoices, setInvoices] = useState<MmdPlusInvoice[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchMmdPlusSummary();
      setCurrent(res.current);
      setPlans(res.plans);
      setInvoices(res.invoices);
    } catch (e: unknown) {
      setError(toUserFacingError(e, "Chargement MMD+ impossible."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const run = useCallback(
    async (action: string, extra?: Record<string, unknown>) => {
      if (busy) return;
      setBusy(action);
      try {
        const res = await mmdPlusAction(action, extra);
        if (res.checkout_url) {
          await Linking.openURL(String(res.checkout_url));
          return;
        }
        if (res.portal_url) {
          await Linking.openURL(String(res.portal_url));
          return;
        }
        await load();
      } catch (e: unknown) {
        Alert.alert("MMD+", toUserFacingError(e, "Action impossible."));
      } finally {
        setBusy(null);
      }
    },
    [busy, load]
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title="MMD+"
        onBack={() => navigation.goBack()}
        fallbackRoute="ClientHome"
        variant="dark"
      />
      {loading ? (
        <View style={styles.stateWrap}>
          <ActivityIndicator color={MMD_GOLD_CLASSIC} />
          <Text style={styles.muted}>Chargement…</Text>
          <View style={styles.stateSpacer} />
          <Image
            source={MMD_LOGO}
            style={styles.footerLogo}
            resizeMode="contain"
            accessibilityLabel="MMD Delivery"
          />
          <Text style={styles.footerBrand}>MMD Delivery</Text>
        </View>
      ) : error ? (
        <View style={styles.stateWrap}>
          <Text style={styles.error}>{error}</Text>
          <TouchableOpacity style={styles.btn} onPress={() => void load()}>
            <Text style={styles.btnText}>Réessayer</Text>
          </TouchableOpacity>
          <View style={styles.stateSpacer} />
          <Image
            source={MMD_LOGO}
            style={styles.footerLogo}
            resizeMode="contain"
            accessibilityLabel="MMD Delivery"
          />
          <Text style={styles.footerBrand}>MMD Delivery</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={MMD_GOLD_CLASSIC}
            />
          }
        >
          <View style={styles.hero} testID="mmd-plus-hero">
            {current ? (
              <>
                <Text style={styles.heroLabel}>Current subscription</Text>
                <Text style={styles.heroTitle}>
                  {current.plan?.name ?? "MMD+"} · {current.status}
                  {current.cancel_at_period_end ? " · canceling" : ""}
                </Text>
                <Text style={styles.muted}>
                  {formatMoney(current.price_cents, current.currency)}
                  {current.is_trial ? " · Trial" : ""}
                  {current.current_period_end
                    ? ` · Renews ${new Date(current.current_period_end).toLocaleDateString()}`
                    : ""}
                </Text>
                {(current.features ?? []).map((f) => (
                  <Text key={f.feature_key} style={styles.feature}>
                    • {f.label ?? f.feature_key}
                  </Text>
                ))}
                <View style={styles.row}>
                  <TouchableOpacity
                    style={styles.btn}
                    disabled={!!busy}
                    onPress={() => void run("portal")}
                    testID="mmd-plus-manage"
                  >
                    <Text style={styles.btnText}>Manage Subscription</Text>
                  </TouchableOpacity>
                  {current.cancel_at_period_end ? (
                    <TouchableOpacity
                      style={styles.btnOutline}
                      disabled={!!busy}
                      onPress={() => void run("resume")}
                    >
                      <Text style={styles.btnOutlineText}>Resume</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={styles.btnOutline}
                      disabled={!!busy}
                      onPress={() => void run("cancel")}
                    >
                      <Text style={styles.btnOutlineText}>Cancel</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            ) : (
              <>
                <Text style={styles.heroLabel}>MMD+</Text>
                <Text style={styles.heroTitle}>No active subscription</Text>
                <Text style={styles.muted}>
                  One plan for Food, Delivery, Taxi and Marketplace benefits.
                </Text>
                {plans[0] ? (
                  <TouchableOpacity
                    style={styles.btn}
                    disabled={!!busy}
                    onPress={() =>
                      void run("checkout", { plan_id: plans[0].id })
                    }
                    testID="mmd-plus-join"
                  >
                    <Text style={styles.btnText}>
                      Join — {formatMoney(plans[0].price_cents, plans[0].currency)}
                      /{plans[0].billing_period === "yearly" ? "yr" : "mo"}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </>
            )}
          </View>

          <Text style={styles.section}>Plans & benefits</Text>
          {plans.length === 0 ? (
            <Text style={styles.muted}>Aucun plan disponible.</Text>
          ) : (
            plans.map((plan) => {
              const isCurrent = current?.plan?.id === plan.id;
              return (
                <View key={plan.id} style={styles.card}>
                  <Text style={styles.cardTitle}>{plan.name}</Text>
                  <Text style={styles.muted}>{plan.description}</Text>
                  <Text style={styles.price}>
                    {formatMoney(plan.price_cents, plan.currency)}/
                    {plan.billing_period === "yearly" ? "an" : "mois"}
                  </Text>
                  {(plan.features ?? []).slice(0, 5).map((f) => (
                    <Text key={f.feature_key} style={styles.feature}>
                      • {f.label ?? f.feature_key}
                    </Text>
                  ))}
                  <TouchableOpacity
                    style={[styles.btn, isCurrent && styles.btnDisabled]}
                    disabled={!!busy || isCurrent}
                    onPress={() =>
                      void run(current ? "change_plan" : "checkout", {
                        plan_id: plan.id,
                      })
                    }
                  >
                    <Text style={styles.btnText}>
                      {isCurrent
                        ? "Current plan"
                        : current
                          ? "Change plan"
                          : "Join"}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )}

          <Text style={styles.section}>Billing</Text>
          {invoices.length === 0 ? (
            <Text style={styles.muted}>No invoices.</Text>
          ) : (
            invoices.map((inv) => (
              <View key={inv.id} style={styles.invoiceRow}>
                <View>
                  <Text style={styles.textSoft}>
                    {inv.description ?? inv.kind} · {inv.status}
                  </Text>
                  <Text style={styles.muted}>
                    {new Date(inv.created_at).toLocaleString()}
                  </Text>
                </View>
                <Text style={styles.textStrong}>
                  {formatMoney(inv.amount_cents, inv.currency)}
                </Text>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40, gap: 12 },
  stateWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
    paddingBottom: 50,
  },
  stateSpacer: { flex: 1, minHeight: 24, width: "100%" },
  footerLogo: { width: 50, height: 50, borderRadius: 25 },
  footerBrand: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 12,
  },
  hero: {
    backgroundColor: MMD_CARD_ON_BLUE_STRONG,
    borderColor: MMD_STROKE,
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 16,
    gap: 6,
  },
  heroLabel: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 12,
    fontWeight: "600",
    fontFamily: MMD_FONT.semibold,
  },
  heroTitle: {
    color: MMD_TEXT,
    fontSize: 20,
    fontWeight: "700",
    fontFamily: MMD_FONT.bold,
  },
  section: {
    color: MMD_TEXT,
    fontSize: 16,
    fontWeight: "700",
    fontFamily: MMD_FONT.bold,
    marginTop: 4,
  },
  card: {
    backgroundColor: MMD_CARD_ON_BLUE_STRONG,
    borderColor: MMD_STROKE,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  cardTitle: {
    color: MMD_TEXT,
    fontSize: 17,
    fontWeight: "700",
    fontFamily: MMD_FONT.bold,
  },
  price: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 18,
    fontWeight: "700",
    fontFamily: MMD_FONT.bold,
    marginVertical: 2,
  },
  feature: {
    color: MMD_TEXT_SOFT_BLUE,
    fontSize: 13,
    marginTop: 2,
    fontFamily: MMD_FONT.regular,
  },
  muted: {
    color: MMD_TEXT_MUTED_BLUE,
    fontSize: 13,
    marginTop: 0,
    fontFamily: MMD_FONT.regular,
  },
  textSoft: {
    color: MMD_TEXT_SOFT_BLUE,
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
  },
  textStrong: {
    color: MMD_TEXT,
    fontWeight: "600",
    fontFamily: MMD_FONT.semibold,
  },
  error: {
    color: "#FCA5A5",
    textAlign: "center",
    fontFamily: MMD_FONT.bold,
  },
  row: { flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" },
  btn: {
    backgroundColor: MMD_GOLD_CLASSIC,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 6,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.5 },
  btnText: {
    color: MMD_BLUE,
    fontWeight: "700",
    fontFamily: MMD_FONT.bold,
    fontSize: 14,
  },
  btnOutline: {
    borderColor: MMD_STROKE,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 6,
  },
  btnOutlineText: {
    color: MMD_WHITE,
    fontWeight: "600",
    fontFamily: MMD_FONT.semibold,
  },
  invoiceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 0,
    borderBottomColor: MMD_STROKE,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
