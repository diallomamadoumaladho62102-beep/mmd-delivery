/**
 * First-run / incomplete Driver setup hub.
 * Does NOT edit legacy vehicle_brand/plate on driver_profiles.
 * Vehicle fleet → DriverVehicles; payouts → DriverWallet; docs → DriverProfile.
 * UI aligned to Figma 265:5920 (Loading) / 265:5921 (Setup).
 */
import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { DriverBrandLoadingState } from "../components/driver/DriverBrandLoadingState";
import {
  changeDriverTransportMode,
} from "../lib/driverServicePreferencesApi";
import {
  computeDriverSetupProgress,
  nextDriverSetupStep,
  type DriverSetupProgress,
} from "../lib/driverSetupProgress";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_LINK_BLUE,
  MMD_STROKE,
  MMD_TEXT,
  MMD_TEXT_MUTED_BLUE,
  MMD_WHITE,
} from "../theme/mmdUi";

type TransportMode = "bike" | "car" | "moto";

const SELECTED_MODE_BG = "#1D4ED8";
const CTA_GREEN = "#37d456";
const CTA_TEXT = "#052e16";

export function DriverOnboardingScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const contentMax = width >= 768 ? 560 : undefined;
  const [loading, setLoading] = useState(true);
  const [savingMode, setSavingMode] = useState(false);
  const [transportMode, setTransportMode] = useState<TransportMode>("bike");
  const [progress, setProgress] = useState<DriverSetupProgress>({
    progress: 0,
    vehicleOk: false,
    docsDone: 0,
    docsTotal: 4,
    payoutOk: false,
    isBike: true,
    needsVehicle: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: authRes, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authRes.user?.id) {
        Alert.alert(
          t("common.errorTitle", "Error"),
          t("driver.home.errors.mustBeLoggedIn", "You must be logged in."),
        );
        return;
      }
      const uid = authRes.user.id;

      try {
        await supabase.functions.invoke("check_connect_status", {
          body: { role: "driver" },
        });
      } catch {
        // non-blocking
      }

      const { data: profile } = await supabase
        .from("driver_profiles")
        .select("transport_mode, active_vehicle_id, stripe_onboarded")
        .or(`user_id.eq.${uid},id.eq.${uid}`)
        .maybeSingle();

      const tm = (String(profile?.transport_mode ?? "bike").toLowerCase() ||
        "bike") as TransportMode;
      setTransportMode(tm === "car" || tm === "moto" || tm === "bike" ? tm : "bike");

      let docs: { doc_type?: string | null; status?: string | null }[] = [];
      const docsRes = await supabase
        .from("driver_documents")
        .select("doc_type, status, driver_id, user_id")
        .or(`driver_id.eq.${uid},user_id.eq.${uid}`);
      if (!docsRes.error) docs = docsRes.data ?? [];

      setProgress(
        computeDriverSetupProgress({
          profile: {
            transport_mode: profile?.transport_mode,
            active_vehicle_id: (profile as { active_vehicle_id?: string | null })
              ?.active_vehicle_id,
            stripe_onboarded: profile?.stripe_onboarded,
          },
          docs,
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const saveTransportMode = async (next: TransportMode) => {
    setSavingMode(true);
    try {
      await changeDriverTransportMode(next);
      setTransportMode(next);
      await load();
    } catch (error) {
      Alert.alert(
        t("common.errorTitle", "Error"),
        String((error as Error)?.message ?? error),
      );
    } finally {
      setSavingMode(false);
    }
  };

  const step = nextDriverSetupStep(progress);

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
        <DriverBrandLoadingState title="Driver Setup" logoAtBottom />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("driver.onboarding.title", "Driver Setup")}
        fallbackRoute="DriverTabs"
        variant="dark"
      />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          contentMax ? { maxWidth: contentMax, alignSelf: "center", width: "100%" } : null,
        ]}
      >
        <View style={styles.card}>
          <Text style={styles.progressTitle}>
            {t("driver.onboarding.progress", "Progress")} · {progress.progress}%
          </Text>
          <Text style={styles.progressNext}>
            {step === "addVehicle"
              ? t("driver.onboarding.next.vehicle", "Add and activate a vehicle")
              : step === "addDocs"
                ? t("driver.onboarding.next.docs", "Complete your documents")
                : step === "setupPayment"
                  ? t("driver.onboarding.next.payout", "Activate Stripe Connect (Wallet)")
                  : t("driver.onboarding.next.ready", "Ready — return to Home")}
          </Text>
          <Text style={styles.progressMeta}>
            Véhicule: {progress.vehicleOk ? "OK" : "manquant"} · Docs:{" "}
            {progress.docsDone}/{progress.docsTotal} · Payout:{" "}
            {progress.payoutOk ? "Ready" : "Setup required"}
          </Text>
        </View>

        <View style={[styles.card, styles.transportCard]}>
          <Text style={styles.sectionTitle}>
            {t("driver.onboarding.transport", "Vehicle Type")}
          </Text>
          {(["car", "moto", "bike"] as TransportMode[]).map((mode) => {
            const selected = transportMode === mode;
            return (
              <TouchableOpacity
                key={mode}
                disabled={savingMode}
                onPress={() => void saveTransportMode(mode)}
                style={[
                  styles.modeRow,
                  selected ? styles.modeRowSelected : null,
                ]}
              >
                <Text style={styles.modeLabel}>
                  {mode === "car" ? "Car" : mode === "moto" ? "Motorcycle" : "Bicycle"}
                  {selected ? " ✓" : ""}
                </Text>
              </TouchableOpacity>
            );
          })}
          {savingMode ? <ActivityIndicator color={MMD_WHITE} /> : null}
        </View>

        <HubRow
          label={t("driver.onboarding.go.vehicles", "My Vehicle")}
          hint={
            progress.vehicleOk
              ? t("driver.onboarding.go.vehiclesOk", "Fleet configured")
              : t("driver.onboarding.go.vehiclesNeed", "Add Car / Motorcycle")
          }
          onPress={() => navigation.navigate("DriverVehicles")}
        />
        <HubRow
          label={t("driver.onboarding.go.profile", "Profile & Documents")}
          hint={t("driver.onboarding.go.profileHint", "Identity, license, insurance")}
          onPress={() => navigation.navigate("DriverProfile")}
        />
        <HubRow
          label={t("driver.onboarding.go.wallet", "Wallet / Stripe Connect")}
          hint={
            progress.payoutOk
              ? t("driver.onboarding.go.walletOk", "Payout ready")
              : t("driver.onboarding.go.walletNeed", "Setup required")
          }
          onPress={() => navigation.navigate("DriverWallet")}
        />
        <HubRow
          label={t("driver.onboarding.go.services", "My Services")}
          hint={t("driver.onboarding.go.servicesHint", "Food, packages, taxi")}
          onPress={() => navigation.navigate("DriverServices")}
        />

        <TouchableOpacity
          onPress={() => navigation.navigate("DriverTabs")}
          style={styles.cta}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>
            {t("driver.onboarding.continue", "Continue to Home")}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function HubRow(props: { label: string; hint: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={props.onPress} style={styles.hubRow} activeOpacity={0.85}>
      <Text style={styles.hubLabel}>{props.label}</Text>
      <Text style={styles.hubHint}>{props.hint}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: MMD_BLUE,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 28,
    gap: 12,
  },
  card: {
    backgroundColor: MMD_BLUE,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    gap: 6,
  },
  transportCard: {
    gap: 10,
  },
  progressTitle: {
    color: MMD_TEXT,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 18,
  },
  progressNext: {
    color: MMD_TEXT_MUTED_BLUE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 13,
  },
  progressMeta: {
    color: MMD_LINK_BLUE,
    fontFamily: MMD_FONT.regular,
    fontSize: 12,
  },
  sectionTitle: {
    color: MMD_TEXT,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
  },
  modeRow: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: MMD_BLUE,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
  },
  modeRowSelected: {
    backgroundColor: SELECTED_MODE_BG,
  },
  modeLabel: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
  },
  hubRow: {
    backgroundColor: MMD_BLUE,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    gap: 4,
  },
  hubLabel: {
    color: MMD_TEXT,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
  },
  hubHint: {
    color: MMD_TEXT_MUTED_BLUE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 12,
  },
  cta: {
    backgroundColor: CTA_GREEN,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
  },
  ctaText: {
    color: CTA_TEXT,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
  },
});

export default DriverOnboardingScreen;
