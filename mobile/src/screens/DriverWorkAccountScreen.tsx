// apps/mobile/src/screens/DriverWorkAccountScreen.tsx
import React, { useCallback, useMemo, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        backgroundColor: "#0B1220",
        borderColor: "#111827",
        borderWidth: 1,
        borderRadius: 18,
        padding: 14,
        marginBottom: 14,
      }}
    >
      <Text style={{ color: "white", fontSize: 18, fontWeight: "900" }}>
        {title}
      </Text>

      {subtitle ? (
        <Text
          style={{
            color: "#9CA3AF",
            fontWeight: "800",
            marginTop: 6,
            lineHeight: 18,
          }}
        >
          {subtitle}
        </Text>
      ) : null}

      <View style={{ height: 10 }} />
      {children}
    </View>
  );
}

function Row({
  label,
  value,
  onPress,
  danger,
  leftIcon,
  chevron,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  leftIcon?: string;
  chevron?: string; // ✅ i18n chevron (si RTL)
}) {
  return (
    <TouchableOpacity
      disabled={!onPress}
      onPress={onPress}
      style={{
        paddingVertical: 14,
        paddingHorizontal: 12,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "#111827",
        backgroundColor: "#0A1730",
        marginBottom: 10,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        opacity: onPress ? 1 : 0.9,
      }}
      activeOpacity={0.85}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          flex: 1,
          paddingRight: 10,
        }}
      >
        {leftIcon ? (
          <Text style={{ width: 24, color: "#93C5FD", fontWeight: "900" }}>
            {leftIcon}
          </Text>
        ) : null}

        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: danger ? "#FCA5A5" : "#E5E7EB",
              fontWeight: "900",
            }}
          >
            {label}
          </Text>

          {value ? (
            <Text style={{ color: "#9CA3AF", fontWeight: "800", marginTop: 4 }}>
              {value}
            </Text>
          ) : null}
        </View>
      </View>

      <Text style={{ color: danger ? "#FCA5A5" : "#93C5FD", fontWeight: "900" }}>
        {onPress ? chevron ?? "›" : ""}
      </Text>
    </TouchableOpacity>
  );
}

function ProgressBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <View
      style={{
        height: 10,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.08)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.10)",
        overflow: "hidden",
        marginTop: 10,
      }}
    >
      <View
        style={{
          height: "100%",
          width: `${v}%`,
          backgroundColor: "rgba(59,130,246,0.7)",
        }}
      />
    </View>
  );
}

type DriverWorkState = {
  progress: number;
  vehicleOk: boolean;
  docsDone: number;
  docsTotal: number;
  payoutOk: boolean;

  // ✅ on stocke les inputs bruts, mais le "nextStep" est calculé via t() au render
  isBike: boolean;
};

const REQUIRED_DOCS = [
  "license",
  "insurance",
  "registration",
  "profile_photo",
  "background_check",
];

function normMode(tm: any) {
  return String(tm ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function isBikeMode(tm: any) {
  const x = normMode(tm);
  return x === "bike" || x === "velo";
}

function needsVehicleDetails(tm: any) {
  const x = normMode(tm);
  return x === "car" || x === "moto" || x === "motorcycle" || x === "scooter";
}

export function DriverWorkAccountScreen() {
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation();

  const [loading, setLoading] = useState(true);

  const [state, setState] = useState<DriverWorkState>({
    progress: 0,
    vehicleOk: false,
    docsDone: 0,
    docsTotal: REQUIRED_DOCS.length,
    payoutOk: false,
    isBike: false,
  });

  const chevron = useMemo(() => {
    // simple RTL: ar -> ‹ (sinon ›)
    const lng = String(i18n.language || "en").toLowerCase();
    return lng.startsWith("ar") ? "‹" : "›";
  }, [i18n.language]);

  const computeNextStepKey = useCallback(
    (vehicleOk: boolean, docsDone: number, docsTotal: number, payoutOk: boolean) => {
      if (!vehicleOk) return "addVehicle";
      if (docsDone < docsTotal) return "addDocs";
      if (!payoutOk) return "setupPayment";
      return "ready";
    },
    []
  );

  const load = useCallback(async () => {
    try {
      setLoading(true);

      const { data: authRes, error: authErr } = await supabase.auth.getUser();
      if (authErr) {
        Alert.alert(t("common.errorTitle", "Error"), authErr.message);
        return;
      }

      const uid = authRes.user?.id;
      if (!uid) {
        Alert.alert(
          t("common.errorTitle", "Error"),
          t("driver.workAccount.auth.noUser", "No user logged in.")
        );
        return;
      }

      // ✅ Optionnel: resync Stripe
      try {
        const { error: syncErr } = await supabase.functions.invoke("check_connect_status");
        if (syncErr) console.log("check_connect_status error:", syncErr);
      } catch (e) {
        console.log("check_connect_status exception:", e);
      }

      const { data: profile, error: pErr } = await supabase
        .from("driver_profiles")
        .select(
          [
            "id",
            "user_id",
            "transport_mode",
            "vehicle_brand",
            "vehicle_model",
            "vehicle_year",
            "plate_number",
            "stripe_onboarded",
            "payout_enabled",
          ].join(",")
        )
        .or(`user_id.eq.${uid},id.eq.${uid}`)
        .maybeSingle();

      if (pErr) console.log("driver_profiles load error:", pErr);

      const tm = (profile as any)?.transport_mode ?? "bike";
      const bike = isBikeMode(tm);
      const needsVehicle = needsVehicleDetails(tm);

      const vehicleOk = !needsVehicle
        ? true
        : Boolean(
            String((profile as any)?.vehicle_brand ?? "").trim() &&
              String((profile as any)?.vehicle_model ?? "").trim() &&
              Number((profile as any)?.vehicle_year ?? 0) > 1900 &&
              String((profile as any)?.plate_number ?? "").trim()
          );

      // ✅ Paiement: Stripe d’abord, fallback payout_enabled
      const stripeOnboarded = Boolean((profile as any)?.stripe_onboarded);
      const payoutEnabledFallback = Boolean((profile as any)?.payout_enabled);
      const payoutOk = stripeOnboarded || payoutEnabledFallback;

      // ✅ Documents
      let docsDone = 0;
      let docsTotal = 0;

      if (bike) {
        docsDone = 0;
        docsTotal = 0;
      } else {
        let docs: any[] = [];

        const first = await supabase
          .from("driver_documents")
          .select("doc_type, status, driver_id, user_id")
          .or(`driver_id.eq.${uid},user_id.eq.${uid}`);

        if (!first.error) {
          docs = first.data ?? [];
        } else {
          const second = await supabase
            .from("driver_documents")
            .select("doc_type, user_id")
            .eq("user_id", uid);

          if (second.error) {
            console.log("driver_documents fallback error:", second.error);
            docs = [];
          } else {
            docs = second.data ?? [];
          }
        }

        const approved = new Set(
          (docs ?? [])
            .filter((x: any) => (x?.status ? x?.status === "approved" : true))
            .map((x: any) => String(x.doc_type))
        );

        docsTotal = REQUIRED_DOCS.length;
        docsDone = REQUIRED_DOCS.filter((tt) => approved.has(tt)).length;
      }

      // ✅ Progress (Vehicle 25 / Docs 50 / Payout 25)
      // Bike: docsScore = 50 (non requis => considéré OK)
      const docsScore = bike ? 50 : docsTotal ? Math.round((docsDone / docsTotal) * 50) : 0;
      const score = (vehicleOk ? 25 : 0) + docsScore + (payoutOk ? 25 : 0);

      setState({
        progress: Math.max(0, Math.min(100, score)),
        vehicleOk,
        docsDone,
        docsTotal,
        payoutOk,
        isBike: bike,
      });
    } catch (e: any) {
      console.log("DriverWorkAccountScreen load error:", e);
      Alert.alert(t("common.errorTitle", "Error"), e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // ✅ nextStep calculé à l’affichage (donc change de langue instantanément)
  const nextStep = useMemo(() => {
    const docsTotalForStep = state.isBike ? 0 : state.docsTotal;
    const key = computeNextStepKey(state.vehicleOk, state.docsDone, docsTotalForStep, state.payoutOk);

    if (key === "addVehicle")
      return t("driver.workAccount.next.addVehicle", "Add vehicle");
    if (key === "addDocs")
      return t("driver.workAccount.next.addDocs", "Add documents");
    if (key === "setupPayment")
      return t("driver.workAccount.next.setupPayment", "Set up payout");
    return t("driver.workAccount.next.ready", "Ready");
  }, [computeNextStepKey, state.docsDone, state.docsTotal, state.isBike, state.payoutOk, state.vehicleOk, t]);

  const go = useCallback(
    (route: string) => {
      // ⚠️ routes à remplacer quand tu ajoutes les écrans
      Alert.alert(
        t("common.soon", "Coming soon ✅"),
        `${t("common.toAdd", "To add")}: ${route}`
      );
    },
    [t]
  );

  const title = useMemo(
    () =>
      t("driver.workAccount.status.title", "Account status • {{pct}}%", {
        pct: state.progress,
      }),
    [t, state.progress]
  );

  const subtitle = useMemo(
    () =>
      t("driver.workAccount.status.subtitle", "Next step: {{step}}", {
        step: nextStep,
      }),
    [t, nextStep]
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      {/* Header */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: 8,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
            {t("common.back", "← Back")}
          </Text>
        </TouchableOpacity>

        <Text style={{ color: "white", fontSize: 16, fontWeight: "900" }}>
          {t("driver.workAccount.header.title", "Driver account")}
        </Text>

        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Status */}
        <SectionCard title={title} subtitle={subtitle}>
          {loading ? (
            <View style={{ paddingVertical: 10 }}>
              <ActivityIndicator />
              <Text style={{ color: "#9CA3AF", marginTop: 10, fontWeight: "800" }}>
                {t("common.loading", "Loading…")}
              </Text>
            </View>
          ) : (
            <>
              <ProgressBar value={state.progress} />
              <View style={{ height: 12 }} />

              <Row
                chevron={chevron}
                leftIcon={state.vehicleOk ? "✅" : "❌"}
                label={t("driver.workAccount.rows.vehicle.label", "Vehicle")}
                value={
                  state.vehicleOk
                    ? t("driver.workAccount.rows.vehicle.ok", "OK")
                    : t("driver.workAccount.rows.vehicle.missing", "To add")
                }
                onPress={() => go("DriverVehicleScreen")}
              />

              <Row
                chevron={chevron}
                leftIcon={
                  state.isBike
                    ? "✅"
                    : state.docsDone >= state.docsTotal
                    ? "✅"
                    : "⏳"
                }
                label={t("driver.workAccount.rows.docs.label", "Documents")}
                value={
                  state.isBike
                    ? t("driver.workAccount.rows.docs.notRequiredBike", "Not required (Bike)")
                    : `${state.docsDone}/${state.docsTotal}`
                }
                onPress={() => go("DriverDocumentsScreen")}
              />

              <Row
                chevron={chevron}
                leftIcon={state.payoutOk ? "✅" : "❌"}
                label={t("driver.workAccount.rows.payment.label", "Payout")}
                value={
                  state.payoutOk
                    ? t("driver.workAccount.rows.payment.ready", "Ready")
                    : t("driver.workAccount.rows.payment.notConfigured", "Not configured")
                }
                onPress={() => go("DriverPayoutScreen")}
              />
            </>
          )}
        </SectionCard>

        {/* Work */}
        <SectionCard
          title={t("driver.workAccount.work.title", "Work")}
          subtitle={t(
            "driver.workAccount.work.subtitle",
            "What impacts your trips and earnings."
          )}
        >
          <Row
            chevron={chevron}
            leftIcon="🏢"
            label={t("driver.workAccount.work.center.label", "Work center")}
            value={t("driver.workAccount.work.center.value", "Zone, preferences, availability")}
            onPress={() => go("DriverWorkCenterScreen")}
          />
          <Row
            chevron={chevron}
            leftIcon="💰"
            label={t("driver.workAccount.work.earnings.label", "Earnings")}
            value={t("driver.workAccount.work.earnings.value", "History, payouts, cashouts")}
            onPress={() => go("DriverEarningsScreen")}
          />
          <Row
            chevron={chevron}
            leftIcon="🧾"
            label={t("driver.workAccount.work.tax.label", "Tax info")}
            value={t("driver.workAccount.work.tax.value", "W-9 / 1099 (later)")}
            onPress={() => go("DriverTaxScreen")}
          />
        </SectionCard>

        {/* Legal */}
        <SectionCard title={t("driver.workAccount.legal.title", "Legal & Help")}>
          <Row
            chevron={chevron}
            leftIcon="🔒"
            label={t("driver.workAccount.legal.privacy.label", "Privacy")}
            value={t("driver.workAccount.legal.privacy.value", "Data, permissions")}
            onPress={() => go("DriverPrivacyScreen")}
          />
          <Row
            chevron={chevron}
            leftIcon="ℹ️"
            label={t("driver.workAccount.legal.about.label", "About")}
            value={t("driver.workAccount.legal.about.value", "Version, support")}
            onPress={() => go("DriverAboutScreen")}
          />
        </SectionCard>

        <Text style={{ color: "#6B7280", marginTop: 6, fontWeight: "700" }}>
          {t("driver.workAccount.footer", "MMD Driver • Driver account")}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
