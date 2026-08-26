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
import { readCustomerTrackingIdentification, driverInitials } from "../../lib/customerTrackingIdentification";
import { ClientServiceBottomNav } from "../../components/navigation/ClientServiceBottomNav";
import {
  BOOT_AUTH_TIMEOUT_MS,
  withTimeout,
} from "../../lib/bootFailOpen";
import { toUserFacingError } from "../../lib/userFacingError";
import { useFocusEffect } from "@react-navigation/native";
import {
  MMD_ACTION_NAVY,
  MMD_BLUE,
  MMD_FONT,
  MMD_GLASS,
  MMD_GOLD_CLASSIC,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../../theme/mmdUi";

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
  const [ride, setRide] = useState<Record<string, unknown> | null>(null);

  const tipDollars = useMemo(() => {
    if (custom.trim()) return parseMoneyToDollars(custom);
    return preset ?? 0;
  }, [custom, preset]);

  const tipCents = Math.round(tipDollars * 100);

  const refresh = useCallback(async () => {
    if (!rideId) {
      setError(t("taxi.tip.missingRide", "Missing ride"));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const out = await withTimeout(
        fetchTaxiRide(rideId),
        BOOT_AUTH_TIMEOUT_MS,
        "taxi_tip_load",
      );
      const ride = (out?.ride ?? out) as Record<string, unknown>;
      setRide(ride);
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
      setError(
        toUserFacingError(e, t("taxi.tip.loadFailed", "Unable to load the ride."))
      );
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
    if (tipPaidOut) {
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
            text: t("taxi.tip.ok", "OK"),
            onPress: () => {
              if (navigation.canGoBack()) navigation.goBack();
              else navigation.navigate("ClientHome");
            },
          },
        ]
      );
      await refresh();
    } catch (e) {
      const message = toUserFacingError(
        e,
        t("taxi.tip.payFailed", "Unable to pay the tip")
      );
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

  const identification = useMemo(
    () => (ride ? readCustomerTrackingIdentification(ride) : null),
    [ride],
  );
  const driverFirst = identification?.driverName
    ? identification.driverName.trim().split(/\s+/)[0]
    : "";

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
        <ScreenHeader
          title={t("taxi.tip.title", "Tip your driver")}
          fallbackRoute="ClientHome"
          variant="dark"
        />
        <View style={styles.centered}>
          <ActivityIndicator color={MMD_TAXI_GREEN} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("taxi.tip.title", "Thank your driver")}
        subtitle={
          driverFirst
            ? t("taxi.tip.madeTripSpecial", "{{name}} made your trip special", {
                name: driverFirst,
              })
            : t(
                "taxi.tip.subtitle",
                "100% of your tip goes to the driver via Stripe.",
              )
        }
        fallbackRoute="ClientHome"
        variant="dark"
      />

      <ScrollView contentContainerStyle={styles.content}>
        {identification?.driverName ? (
          <View style={styles.driverCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {driverInitials(identification.driverName)}
              </Text>
            </View>
            <Text style={styles.driverName}>{identification.driverName}</Text>
            {identification.driverRating != null ? (
              <Text style={styles.driverMeta}>
                {`★ ${identification.driverRating.toFixed(1)}`}
                {identification.driverTrips != null
                  ? ` · ${t("taxi.tracking.tripsCount", "{{count}} trips", {
                      count: identification.driverTrips,
                    })}`
                  : ""}
              </Text>
            ) : null}
            {identification.vehicleLabel || identification.vehiclePlate ? (
              <Text style={styles.vehicleMeta}>
                {[identification.vehicleLabel, identification.vehiclePlate]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            ) : null}
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {tipPaidOut ? (
          <View style={styles.successBox}>
            <Text style={styles.successTitle}>
              {t("taxi.tip.alreadyTitle", "Tip already sent")}
            </Text>
            <Text style={styles.successBody}>
              {formatTaxiCents(alreadyTippedCents, currency)}
              {` · ${t("taxi.tip.transferred", "Transferred to driver")}`}
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.label}>
              {t("taxi.tip.choose", "Choose your tip")}
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
                      {formatTaxiCents(v * 100, currency)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.label, { marginTop: 16 }]}>
              {t("taxi.tip.custom", "Or enter a custom amount")}
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
                placeholder={t("taxi.tip.customPlaceholder", "0.00")}
                placeholderTextColor="#64748B"
                style={styles.input}
              />
            </View>

            <View style={{ alignItems: "center", marginTop: 18, gap: 6 }}>
              <Text style={styles.summary}>{t("taxi.tip.youPay", "You pay:")}</Text>
              <Text style={styles.summaryStrong}>
                {formatTaxiCents(tipCents, currency)}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.payBtn, paying && { opacity: 0.7 }]}
              disabled={paying || tipCents < 50}
              onPress={() => void onPayTip()}
            >
              {paying ? (
                <ActivityIndicator color={MMD_WHITE} />
              ) : (
                <Text style={styles.payLabel}>
                  💳 {t("taxi.tip.payCta", "Pay tip with card")}
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
      <ClientServiceBottomNav
        active="track"
        appearance="glass"
        accent="green"
        layout="edge"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MMD_BLUE },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 24, paddingBottom: 120, gap: 4 },
  driverCard: {
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC,
    borderRadius: 28,
    padding: 20,
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: MMD_GOLD_CLASSIC,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: MMD_WHITE,
    fontSize: 28,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
  },
  driverName: {
    color: MMD_WHITE,
    fontSize: 24,
    fontWeight: "700",
    fontFamily: MMD_FONT.bold,
    textAlign: "center",
  },
  driverMeta: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 16,
    fontFamily: MMD_FONT.regular,
  },
  vehicleMeta: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
    textAlign: "center",
  },
  label: {
    color: MMD_GOLD_CLASSIC,
    fontWeight: "700",
    fontFamily: MMD_FONT.bold,
    fontSize: 14,
    marginBottom: 10,
    textAlign: "center",
  },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexGrow: 1,
    minWidth: 54,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: MMD_ACTION_NAVY,
  },
  chipSelected: {
    backgroundColor: MMD_TAXI_GREEN,
  },
  chipText: { color: MMD_WHITE, fontWeight: "700", fontFamily: MMD_FONT.bold, fontSize: 18 },
  chipTextSelected: { color: MMD_WHITE },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  dollar: { color: MMD_WHITE, fontWeight: "900", fontFamily: MMD_FONT.bold, marginRight: 8, fontSize: 28 },
  input: { flex: 1, color: MMD_WHITE, fontSize: 28, fontWeight: "700", fontFamily: MMD_FONT.bold },
  summary: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 16,
    fontWeight: "400",
    fontFamily: MMD_FONT.regular,
    textAlign: "center",
  },
  summaryStrong: {
    color: MMD_WHITE,
    fontWeight: "700",
    fontFamily: MMD_FONT.bold,
    fontSize: 42,
    textAlign: "center",
  },
  payBtn: {
    marginTop: 18,
    backgroundColor: MMD_TAXI_GREEN,
    borderRadius: 20,
    paddingVertical: 18,
    alignItems: "center",
  },
  payLabel: { color: MMD_WHITE, fontWeight: "700", fontFamily: MMD_FONT.bold, fontSize: 20 },
  skipBtn: { marginTop: 14, alignItems: "center", padding: 12 },
  skipLabel: {
    color: "rgba(255,255,255,0.4)",
    fontWeight: "400",
    fontFamily: MMD_FONT.regular,
    fontSize: 14,
  },
  errorBox: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: "rgba(239,68,68,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
    marginBottom: 14,
  },
  errorText: { color: "#FCA5A5", fontWeight: "700", fontFamily: MMD_FONT.bold },
  successBox: {
    padding: 24,
    borderRadius: 28,
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC,
    alignItems: "center",
  },
  successTitle: {
    color: MMD_WHITE,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
    fontSize: 22,
    textAlign: "center",
  },
  successBody: {
    color: "rgba(255,255,255,0.7)",
    marginTop: 8,
    fontWeight: "600",
    fontFamily: MMD_FONT.semibold,
    textAlign: "center",
  },
});
