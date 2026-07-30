import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import { payTaxiTipWithPaymentSheet } from "../../utils/stripe";
import { formatTaxiCents, fetchTaxiRide } from "../../lib/taxiClientApi";
import { toUserFacingError } from "../../lib/userFacingError";
import { APP_COLORS } from "../../theme/appTheme";
import { useFocusEffect } from "@react-navigation/native";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiTip">;
type TipRoute = RouteProp<RootStackParamList, "TaxiTip">;

const TIP_PRESETS_DOLLARS = [2, 3, 5, 8, 10] as const;

function sanitizeMoneyInput(txt: string) {
  return txt.replace(/[^0-9.,]/g, "").replace(/,/g, ".");
}

function parseMoneyToDollars(txt: string) {
  const n = Number(sanitizeMoneyInput(txt));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export default function TaxiTipScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<TipRoute>();
  const { t } = useTranslation();
  const rideId = String(route.params?.rideId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [currency, setCurrency] = useState("USD");
  const [alreadyTippedCents, setAlreadyTippedCents] = useState(0);
  const [tipPaidOut, setTipPaidOut] = useState(false);
  const [preset, setPreset] = useState<number | null>(3);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);

  const tipDollars = useMemo(() => {
    if (custom.trim()) return parseMoneyToDollars(custom);
    return preset ?? 0;
  }, [custom, preset]);

  const tipCents = Math.round(tipDollars * 100);

  const refresh = useCallback(async () => {
    if (!rideId) {
      setError("Missing ride");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const out = await fetchTaxiRide(rideId);
      const ride = (out?.ride ?? out) as Record<string, unknown>;
      setCurrency(String(ride?.currency ?? "USD"));
      const tip = Math.max(0, Math.round(Number(ride?.tip_cents ?? 0)));
      setAlreadyTippedCents(tip);
      setTipPaidOut(Boolean(ride?.tip_paid_out) || Boolean(ride?.tip_transfer_id));
      if (String(ride?.status ?? "").toLowerCase() !== "completed") {
        setError(
          t("taxi.tip.rideNotCompleted", "Tips are available after the ride is completed.")
        );
      }
    } catch (e) {
      setError(toUserFacingError(e, "Unable to load ride"));
    } finally {
      setLoading(false);
    }
  }, [rideId, t]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  async function onPayTip() {
    if (paying) return;
    if (tipPaidOut || alreadyTippedCents > 0) {
      Alert.alert(
        t("taxi.tip.alreadyTitle", "Tip already sent"),
        t("taxi.tip.alreadyBody", "This ride already has a tip.")
      );
      return;
    }
    if (tipCents < 50) {
      Alert.alert(
        t("taxi.tip.minTitle", "Tip too small"),
        t("taxi.tip.minBody", "Minimum tip is $0.50.")
      );
      return;
    }

    setPaying(true);
    try {
      const ok = await payTaxiTipWithPaymentSheet({ taxiRideId: rideId, tipCents });
      if (!ok) return;
      Alert.alert(
        t("taxi.tip.successTitle", "Thank you!"),
        t(
          "taxi.tip.successBody",
          "Your tip was paid. The driver will receive it on their wallet."
        ),
        [
          {
            text: "OK",
            onPress: () => {
              if (navigation.canGoBack()) navigation.goBack();
              else navigation.navigate("ClientHome");
            },
          },
        ]
      );
      await refresh();
    } catch (e) {
      const message = toUserFacingError(e, "Unable to pay tip");
      if (/annul|cancel/i.test(message)) {
        Alert.alert(
          t("taxi.tip.cancelledTitle", "Tip cancelled"),
          t("taxi.tip.cancelledBody", "No charge was made.")
        );
      } else {
        Alert.alert(t("common.errorTitle", "Error"), message);
      }
    } finally {
      setPaying(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
        <ScreenHeader
          title={t("taxi.tip.title", "Tip your driver")}
          fallbackRoute="ClientHome"
          variant="dark"
        />
        <View style={styles.centered}>
          <ActivityIndicator color={APP_COLORS.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("taxi.tip.title", "Tip your driver")}
        subtitle={t(
          "taxi.tip.subtitle",
          "100% of your tip goes to the driver via Stripe."
        )}
        fallbackRoute="ClientHome"
        variant="dark"
      />

      <ScrollView contentContainerStyle={styles.content}>
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {tipPaidOut || alreadyTippedCents > 0 ? (
          <View style={styles.successBox}>
            <Text style={styles.successTitle}>
              {t("taxi.tip.alreadyTitle", "Tip already sent")}
            </Text>
            <Text style={styles.successBody}>
              {formatTaxiCents(alreadyTippedCents, currency)}
              {tipPaidOut
                ? ` · ${t("taxi.tip.transferred", "Transferred to driver")}`
                : ""}
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.label}>
              {t("taxi.tip.suggested", "Suggested amounts")}
            </Text>
            <View style={styles.rowWrap}>
              {TIP_PRESETS_DOLLARS.map((v) => {
                const selected = !custom.trim() && preset === v;
                return (
                  <TouchableOpacity
                    key={v}
                    onPress={() => {
                      setPreset(v);
                      setCustom("");
                    }}
                    style={[styles.chip, selected && styles.chipSelected]}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      ${v}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.label, { marginTop: 16 }]}>
              {t("taxi.tip.custom", "Custom amount")}
            </Text>
            <View style={styles.inputRow}>
              <Text style={styles.dollar}>$</Text>
              <TextInput
                value={custom}
                onChangeText={(txt) => {
                  setCustom(sanitizeMoneyInput(txt));
                  setPreset(null);
                }}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#64748B"
                style={styles.input}
              />
            </View>

            <Text style={styles.summary}>
              {t("taxi.tip.youPay", "You pay")}:{" "}
              <Text style={styles.summaryStrong}>
                {formatTaxiCents(tipCents, currency)}
              </Text>
            </Text>

            <TouchableOpacity
              style={[styles.payBtn, paying && { opacity: 0.7 }]}
              disabled={paying || tipCents < 50}
              onPress={() => void onPayTip()}
            >
              {paying ? (
                <ActivityIndicator color="#0F172A" />
              ) : (
                <Text style={styles.payLabel}>
                  {t("taxi.tip.payCta", "Pay tip with card")}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.skipBtn}
              onPress={() => {
                if (navigation.canGoBack()) navigation.goBack();
                else navigation.navigate("ClientHome");
              }}
            >
              <Text style={styles.skipLabel}>
                {t("taxi.tip.skip", "No tip this time")}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: APP_COLORS.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingBottom: 40 },
  label: { color: "#94A3B8", fontWeight: "700", fontSize: 13, marginBottom: 10 },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.25)",
  },
  chipSelected: {
    borderColor: "rgba(34,197,94,0.55)",
    backgroundColor: "rgba(34,197,94,0.12)",
  },
  chipText: { color: "#94A3B8", fontWeight: "800" },
  chipTextSelected: { color: "#86EFAC" },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.22)",
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(2,6,23,0.45)",
  },
  dollar: { color: "#94A3B8", fontWeight: "900", marginRight: 8 },
  input: { flex: 1, color: "#F8FAFC", fontSize: 18, fontWeight: "700" },
  summary: { color: "#CBD5E1", marginTop: 18, fontSize: 14, fontWeight: "600" },
  summaryStrong: { color: "#F8FAFC", fontWeight: "900" },
  payBtn: {
    marginTop: 18,
    backgroundColor: "#F59E0B",
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
  },
  payLabel: { color: "#0F172A", fontWeight: "900", fontSize: 16 },
  skipBtn: { marginTop: 14, alignItems: "center", padding: 12 },
  skipLabel: { color: "#94A3B8", fontWeight: "700" },
  errorBox: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: "rgba(239,68,68,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
    marginBottom: 14,
  },
  errorText: { color: "#FCA5A5", fontWeight: "700" },
  successBox: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: "rgba(34,197,94,0.12)",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.35)",
  },
  successTitle: { color: "#86EFAC", fontWeight: "900", fontSize: 16 },
  successBody: { color: "#CBD5E1", marginTop: 8, fontWeight: "600" },
});
