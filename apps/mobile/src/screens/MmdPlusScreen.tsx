import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
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

type Nav = NativeStackNavigationProp<RootStackParamList, "MmdPlus">;

const COLORS = {
  bg: "#0B1220",
  surface: "rgba(15,23,42,0.95)",
  border: "#334155",
  accent: "#F59E0B",
  textStrong: "#F8FAFC",
  textMuted: "#94A3B8",
  textSoft: "#CBD5E1",
};

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
      <ScreenHeader
        title="MMD+"
        onBack={() => navigation.goBack()}
        fallbackRoute="ClientHome"
      />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.accent} />
          <Text style={styles.muted}>Chargement…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <TouchableOpacity style={styles.btn} onPress={() => void load()}>
            <Text style={styles.btnText}>Réessayer</Text>
          </TouchableOpacity>
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
              tintColor={COLORS.accent}
            />
          }
        >
          <View style={styles.hero}>
            {current ? (
              <>
                <Text style={styles.heroLabel}>Abonnement actuel</Text>
                <Text style={styles.heroTitle}>
                  {current.plan?.name ?? "MMD+"} · {current.status}
                </Text>
                <Text style={styles.muted}>
                  {formatMoney(current.price_cents, current.currency)}
                  {current.is_trial ? " · Essai" : ""}
                  {current.current_period_end
                    ? ` · Échéance ${new Date(current.current_period_end).toLocaleDateString()}`
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
                  >
                    <Text style={styles.btnText}>Gérer</Text>
                  </TouchableOpacity>
                  {current.cancel_at_period_end ? (
                    <TouchableOpacity
                      style={styles.btnOutline}
                      disabled={!!busy}
                      onPress={() => void run("resume")}
                    >
                      <Text style={styles.btnOutlineText}>Reprendre</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={styles.btnOutline}
                      disabled={!!busy}
                      onPress={() => void run("cancel")}
                    >
                      <Text style={styles.btnOutlineText}>Annuler</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            ) : (
              <>
                <Text style={styles.heroTitle}>Aucun abonnement actif</Text>
                <Text style={styles.muted}>
                  Un seul abonnement pour Food, Delivery, Taxi et Marketplace.
                </Text>
              </>
            )}
          </View>

          <Text style={styles.section}>Comparer les plans</Text>
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
                      {isCurrent ? "Plan actuel" : current ? "Changer" : "Souscrire"}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )}

          <Text style={styles.section}>Facturation</Text>
          {invoices.length === 0 ? (
            <Text style={styles.muted}>Aucune facture.</Text>
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
  safe: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  hero: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  heroLabel: { color: COLORS.accent, fontSize: 12, fontWeight: "600", textTransform: "uppercase" },
  heroTitle: { color: COLORS.textStrong, fontSize: 20, fontWeight: "700", marginTop: 4 },
  section: { color: COLORS.textStrong, fontSize: 16, fontWeight: "700", marginTop: 8, marginBottom: 10 },
  card: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  cardTitle: { color: COLORS.textStrong, fontSize: 17, fontWeight: "700" },
  price: { color: COLORS.accent, fontSize: 18, fontWeight: "700", marginVertical: 8 },
  feature: { color: COLORS.textSoft, fontSize: 13, marginTop: 2 },
  muted: { color: COLORS.textMuted, fontSize: 13, marginTop: 4 },
  textSoft: { color: COLORS.textSoft, fontSize: 13 },
  textStrong: { color: COLORS.textStrong, fontWeight: "600" },
  error: { color: "#FCA5A5", textAlign: "center" },
  row: { flexDirection: "row", gap: 8, marginTop: 12 },
  btn: {
    backgroundColor: COLORS.accent,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 10,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: "#0B1220", fontWeight: "700" },
  btnOutline: {
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 10,
  },
  btnOutlineText: { color: COLORS.textStrong, fontWeight: "600" },
  invoiceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
