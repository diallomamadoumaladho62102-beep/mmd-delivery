import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { toUserFacingError } from "../lib/userFacingError";
import { fetchMarketingSummary, validateMarketingCode } from "../lib/marketingApi";
import type { RootStackParamList } from "../navigation/AppNavigator";

type Nav = NativeStackNavigationProp<RootStackParamList, "Promotions">;

const COLORS = {
  bg: "#0B1220",
  surface: "rgba(15,23,42,0.95)",
  border: "#334155",
  accent: "#34D399",
  textStrong: "#F8FAFC",
  textMuted: "#94A3B8",
  textSoft: "#CBD5E1",
};

export default function PromotionsScreen() {
  const navigation = useNavigation<Nav>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offers, setOffers] = useState<Array<Record<string, unknown>>>([]);
  const [coupons, setCoupons] = useState<Array<Record<string, unknown>>>([]);
  const [code, setCode] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchMarketingSummary({
        service: "food",
        subtotalCents: 2500,
        deliveryFeeCents: 500,
      });
      setOffers((res.offers as Array<Record<string, unknown>>) ?? []);
      setCoupons((res.coupons as Array<Record<string, unknown>>) ?? []);
    } catch (e: unknown) {
      setError(toUserFacingError(e, "Chargement impossible."));
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

  const onValidate = useCallback(async () => {
    try {
      const res = await validateMarketingCode({
        service: "food",
        promo_code: code,
        subtotal_cents: 2500,
        delivery_fee_cents: 500,
      });
      const disc = Number(res.resolve?.order_discount_cents ?? 0);
      const fee = Number(res.resolve?.delivery_fee_discount_cents ?? 0);
      Alert.alert(
        "Promotions",
        disc + fee > 0
          ? `Code accepté (−${(disc / 100).toFixed(2)} $ / −${(fee / 100).toFixed(2)} $ livraison)`
          : "Code accepté."
      );
    } catch (e: unknown) {
      Alert.alert("Promotions", toUserFacingError(e, "Code refusé."));
    }
  }, [code]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <ScreenHeader title="Promotions" fallbackRoute="ClientHome" />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.accent} />
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
          <View style={styles.card}>
            <Text style={styles.section}>Code promo</Text>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
              placeholder="CODEPROMO"
              placeholderTextColor={COLORS.textMuted}
            />
            <TouchableOpacity style={styles.btn} onPress={() => void onValidate()}>
              <Text style={styles.btnText}>Vérifier</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.section}>Mes coupons</Text>
          {coupons.length === 0 ? (
            <Text style={styles.muted}>Aucun coupon.</Text>
          ) : (
            coupons.map((c) => (
              <View key={String(c.id)} style={styles.card}>
                <Text style={styles.title}>
                  {String(
                    (c.marketing_campaigns as { name?: string } | null)?.name ?? "Coupon"
                  )}
                </Text>
                <Text style={styles.muted}>
                  {c.value_percent != null ? `${c.value_percent}%` : ""}
                  {c.expires_at
                    ? ` · expire ${new Date(String(c.expires_at)).toLocaleDateString()}`
                    : ""}
                </Text>
              </View>
            ))
          )}

          <Text style={styles.section}>Offres</Text>
          {offers.length === 0 ? (
            <Text style={styles.muted}>Aucune offre.</Text>
          ) : (
            offers.map((o) => (
              <View key={String(o.id)} style={styles.card}>
                <Text style={styles.title}>{String(o.name)}</Text>
                <Text style={styles.muted}>{String(o.description ?? "")}</Text>
              </View>
            ))
          )}

          <TouchableOpacity
            style={styles.link}
            onPress={() => navigation.navigate("MmdPlus")}
          >
            <Text style={styles.linkText}>Voir aussi MMD+</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  card: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  section: { color: COLORS.textStrong, fontSize: 16, fontWeight: "700", marginBottom: 8, marginTop: 8 },
  title: { color: COLORS.textStrong, fontWeight: "700", fontSize: 15 },
  muted: { color: COLORS.textMuted, fontSize: 13, marginTop: 4 },
  error: { color: "#FCA5A5" },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: COLORS.textStrong,
    marginBottom: 10,
  },
  btn: {
    backgroundColor: COLORS.accent,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  btnText: { color: "#0B1220", fontWeight: "700" },
  link: { marginTop: 16, alignItems: "center" },
  linkText: { color: COLORS.accent, fontWeight: "600" },
});
