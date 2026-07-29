/**
 * First-run / incomplete Driver setup hub.
 * Does NOT edit legacy vehicle_brand/plate on driver_profiles.
 * Vehicle fleet → DriverVehicles; payouts → DriverWallet; docs → DriverProfile.
 */
import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import ScreenHeader from "../components/navigation/ScreenHeader";
import {
  changeDriverTransportMode,
} from "../lib/driverServicePreferencesApi";
import {
  computeDriverSetupProgress,
  nextDriverSetupStep,
  type DriverSetupProgress,
} from "../lib/driverSetupProgress";

type TransportMode = "bike" | "car" | "moto";

export function DriverOnboardingScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
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
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: "#020617",
          alignItems: "center",
          justifyContent: "center",
        }}
        edges={["bottom", "left", "right"]}
      >
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("driver.onboarding.title", "Configuration chauffeur")}
        fallbackRoute="DriverTabs"
        variant="dark"
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28, gap: 12 }}>
        <View
          style={{
            backgroundColor: "#0B1220",
            borderRadius: 16,
            padding: 14,
            borderWidth: 1,
            borderColor: "#111827",
          }}
        >
          <Text style={{ color: "#F8FAFC", fontWeight: "900", fontSize: 18 }}>
            {t("driver.onboarding.progress", "Progression")} · {progress.progress}%
          </Text>
          <Text style={{ color: "#94A3B8", marginTop: 6, fontWeight: "700" }}>
            {step === "addVehicle"
              ? t("driver.onboarding.next.vehicle", "Ajoutez et activez un véhicule")
              : step === "addDocs"
                ? t("driver.onboarding.next.docs", "Complétez vos documents")
                : step === "setupPayment"
                  ? t("driver.onboarding.next.payout", "Activez Stripe Connect (Wallet)")
                  : t("driver.onboarding.next.ready", "Prêt — retournez à l'accueil")}
          </Text>
          <Text style={{ color: "#64748B", marginTop: 8, fontSize: 12 }}>
            Véhicule: {progress.vehicleOk ? "OK" : "manquant"} · Docs:{" "}
            {progress.docsDone}/{progress.docsTotal} · Payout:{" "}
            {progress.payoutOk ? "Ready" : "Setup required"}
          </Text>
        </View>

        <View
          style={{
            backgroundColor: "#0B1220",
            borderRadius: 16,
            padding: 14,
            gap: 10,
          }}
        >
          <Text style={{ color: "#F8FAFC", fontWeight: "800" }}>
            {t("driver.onboarding.transport", "Type de véhicule")}
          </Text>
          {(["car", "moto", "bike"] as TransportMode[]).map((mode) => (
            <TouchableOpacity
              key={mode}
              disabled={savingMode}
              onPress={() => void saveTransportMode(mode)}
              style={{
                padding: 12,
                borderRadius: 12,
                backgroundColor: transportMode === mode ? "#1D4ED8" : "#111827",
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "800" }}>
                {mode === "car" ? "Car" : mode === "moto" ? "Motorcycle" : "Bicycle"}
                {transportMode === mode ? " ✓" : ""}
              </Text>
            </TouchableOpacity>
          ))}
          {savingMode ? <ActivityIndicator color="#fff" /> : null}
        </View>

        <HubRow
          label={t("driver.onboarding.go.vehicles", "Mon véhicule")}
          hint={
            progress.vehicleOk
              ? t("driver.onboarding.go.vehiclesOk", "Flotte configurée")
              : t("driver.onboarding.go.vehiclesNeed", "Ajouter Car / Motorcycle")
          }
          onPress={() => navigation.navigate("DriverVehicles")}
        />
        <HubRow
          label={t("driver.onboarding.go.profile", "Profil & documents")}
          hint={t("driver.onboarding.go.profileHint", "Identité, permis, assurance")}
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
          label={t("driver.onboarding.go.services", "Mes services")}
          hint={t("driver.onboarding.go.servicesHint", "Food, colis, taxi")}
          onPress={() => navigation.navigate("DriverServices")}
        />

        <TouchableOpacity
          onPress={() => navigation.navigate("DriverTabs")}
          style={{
            marginTop: 8,
            backgroundColor: "#22C55E",
            borderRadius: 14,
            paddingVertical: 14,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#052e16", fontWeight: "900" }}>
            {t("driver.onboarding.continue", "Continuer vers l'accueil")}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function HubRow(props: { label: string; hint: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={props.onPress}
      style={{
        backgroundColor: "#0B1220",
        borderRadius: 14,
        padding: 14,
        borderWidth: 1,
        borderColor: "#1E293B",
      }}
    >
      <Text style={{ color: "#F8FAFC", fontWeight: "800" }}>{props.label}</Text>
      <Text style={{ color: "#94A3B8", marginTop: 4, fontWeight: "600" }}>
        {props.hint}
      </Text>
    </TouchableOpacity>
  );
}

export default DriverOnboardingScreen;
