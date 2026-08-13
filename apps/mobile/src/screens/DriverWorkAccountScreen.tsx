/**
 * Driver work account hub — status, work links, legal.
 * UI aligned to Figma 265:5926 (Loading) / 265:5927 (Default).
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
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
  computeDriverSetupProgress,
  nextDriverSetupStep,
  type DriverSetupProgress,
} from "../lib/driverSetupProgress";
import {
  MMD_BLUE,
  MMD_DRIVER_LINK,
  MMD_FONT,
  MMD_LINK_BLUE,
  MMD_STROKE,
  MMD_TEXT_MUTED_BLUE,
  MMD_WHITE,
} from "../theme/mmdUi";

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
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? (
        <>
          <View style={{ height: 6 }} />
          <Text style={styles.sectionSubtitle}>{subtitle}</Text>
        </>
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
  chevron?: string;
}) {
  return (
    <TouchableOpacity
      disabled={!onPress}
      onPress={onPress}
      style={[styles.row, { opacity: onPress ? 1 : 0.9 }]}
      activeOpacity={0.85}
    >
      <View style={styles.rowLeft}>
        {leftIcon ? <Text style={styles.rowIcon}>{leftIcon}</Text> : null}
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowLabel, danger ? styles.rowLabelDanger : null]}>
            {label}
          </Text>
          {value ? <Text style={styles.rowValue}>{value}</Text> : null}
        </View>
      </View>
      <Text style={[styles.rowChevron, danger ? styles.rowLabelDanger : null]}>
        {onPress ? chevron ?? "›" : ""}
      </Text>
    </TouchableOpacity>
  );
}

function ProgressBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${v}%` }]} />
    </View>
  );
}

const EMPTY_STATE: DriverSetupProgress = {
  progress: 0,
  vehicleOk: false,
  docsDone: 0,
  docsTotal: 4,
  payoutOk: false,
  isBike: false,
  needsVehicle: false,
};

export function DriverWorkAccountScreen() {
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation();
  const { width } = useWindowDimensions();
  const contentMax = width >= 768 ? 560 : undefined;

  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<DriverSetupProgress>(EMPTY_STATE);

  const chevron = useMemo(() => {
    const lng = String(i18n.language || "en").toLowerCase();
    return lng.startsWith("ar") ? "‹" : "›";
  }, [i18n.language]);

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
          t("driver.workAccount.auth.noUser", "No user logged in."),
        );
        return;
      }

      try {
        const { error: syncErr } = await supabase.functions.invoke("check_connect_status", {
          body: { role: "driver" },
        });
        if (syncErr) console.log("check_connect_status error:", syncErr);
      } catch (e) {
        console.log("check_connect_status exception:", e);
      }

      const { data: profile, error: pErr } = await supabase
        .from("driver_profiles")
        .select("transport_mode,active_vehicle_id,stripe_onboarded")
        .or(`user_id.eq.${uid},id.eq.${uid}`)
        .maybeSingle();

      if (pErr) console.log("driver_profiles load error:", pErr);

      let docs: { doc_type?: string | null; status?: string | null }[] = [];

      const first = await supabase
        .from("driver_documents")
        .select("doc_type, status, driver_id, user_id")
        .or(`driver_id.eq.${uid},user_id.eq.${uid}`);

      if (!first.error) {
        docs = first.data ?? [];
      } else {
        const second = await supabase
          .from("driver_documents")
          .select("doc_type, status, user_id")
          .eq("user_id", uid);

        if (second.error) {
          console.log("driver_documents fallback error:", second.error);
          docs = [];
        } else {
          docs = second.data ?? [];
        }
      }

      const computed = computeDriverSetupProgress({
        profile: {
          transport_mode: (profile as any)?.transport_mode,
          active_vehicle_id: (profile as any)?.active_vehicle_id,
          stripe_onboarded: (profile as any)?.stripe_onboarded,
        },
        docs,
      });

      setState(computed);
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
    }, [load]),
  );

  const nextStep = useMemo(() => {
    const key = nextDriverSetupStep(state);

    if (key === "addVehicle")
      return t("driver.workAccount.next.addVehicle", "Add vehicle");
    if (key === "addDocs")
      return t("driver.workAccount.next.addDocs", "Add documents");
    if (key === "setupPayment")
      return t("driver.workAccount.next.setupPayment", "Set up payout");
    return t("driver.workAccount.next.ready", "Ready");
  }, [state, t]);

  const go = useCallback(
    (route: string) => {
      switch (route) {
        case "DriverVehicleScreen":
        case "DriverVehicles":
          navigation.navigate("DriverVehicles");
          return;
        case "DriverDocumentsScreen":
        case "DriverProfile":
          navigation.navigate("DriverProfile");
          return;
        case "DriverPayoutScreen":
        case "DriverWallet":
        case "DriverEarningsScreen":
          navigation.navigate("DriverWallet");
          return;
        case "DriverWorkCenterScreen":
        case "DriverServices":
          navigation.navigate("DriverServices");
          return;
        case "DriverTaxScreen":
        case "DriverTax":
          navigation.navigate("DriverTax");
          return;
        case "DriverPrivacyScreen":
          navigation.navigate("DriverPrivacyScreen");
          return;
        case "DriverAboutScreen":
          navigation.navigate("DriverAboutScreen");
          return;
        case "DriverIdentityVerification":
          navigation.navigate("DriverIdentityVerification");
          return;
        default:
          console.warn("[DriverWorkAccount] unknown route alias:", route);
          navigation.navigate("DriverAccount");
      }
    },
    [navigation],
  );

  const title = useMemo(
    () =>
      t("driver.workAccount.status.title", "Account status • {{pct}}%", {
        pct: state.progress,
      }),
    [t, state.progress],
  );

  const subtitle = useMemo(
    () =>
      t("driver.workAccount.status.subtitle", "Next step: {{step}}", {
        step: nextStep,
      }),
    [t, nextStep],
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
        <ScreenHeader
          title={t("driver.workAccount.header.title", "Driver account")}
          fallbackRoute="DriverTabs"
          variant="dark"
        />
        <DriverBrandLoadingState title="Account status" logoAtBottom />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("driver.workAccount.header.title", "Driver account")}
        fallbackRoute="DriverTabs"
        variant="dark"
      />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          contentMax ? { maxWidth: contentMax, alignSelf: "center", width: "100%" } : null,
        ]}
        showsVerticalScrollIndicator={false}
      >
        <SectionCard title={title} subtitle={subtitle}>
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
        </SectionCard>

        <View style={{ height: 14 }} />

        <SectionCard
          title={t("driver.workAccount.work.title", "Work")}
          subtitle={t(
            "driver.workAccount.work.subtitle",
            "What impacts your trips and earnings.",
          )}
        >
          <Row
            chevron={chevron}
            leftIcon="🏢"
            label={t("driver.workAccount.work.center.label", "Work center")}
            value={t(
              "driver.workAccount.work.center.value",
              "Zone, preferences, availability",
            )}
            onPress={() => go("DriverWorkCenterScreen")}
          />
          <Row
            chevron={chevron}
            leftIcon="💰"
            label={t("driver.workAccount.work.earnings.label", "Earnings")}
            value={t(
              "driver.workAccount.work.earnings.value",
              "History, payouts, cashouts",
            )}
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

        <View style={{ height: 14 }} />

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

        <View style={{ height: 6 }} />
        <Text style={styles.footer}>
          {t("driver.workAccount.footer", "MMD Driver • Driver account")}
        </Text>
      </ScrollView>
    </SafeAreaView>
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
  },
  sectionCard: {
    backgroundColor: MMD_BLUE,
    borderColor: MMD_STROKE,
    borderWidth: 1.5,
    borderRadius: 18,
    padding: 14,
  },
  sectionTitle: {
    color: MMD_WHITE,
    fontSize: 20,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  sectionSubtitle: {
    color: MMD_TEXT_MUTED_BLUE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 16,
    lineHeight: 20,
  },
  row: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    backgroundColor: MMD_BLUE,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    paddingRight: 10,
    gap: 8,
  },
  rowIcon: {
    width: 24,
    color: MMD_DRIVER_LINK,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 16,
  },
  rowLabel: {
    color: "#E5E7EB",
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 16,
  },
  rowLabelDanger: {
    color: "#FCA5A5",
  },
  rowValue: {
    color: MMD_TEXT_MUTED_BLUE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 14,
    marginTop: 4,
  },
  rowChevron: {
    color: MMD_DRIVER_LINK,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 20,
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(0,51,153,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "rgba(59,130,246,0.7)",
    borderRadius: 999,
  },
  footer: {
    color: MMD_LINK_BLUE,
    marginTop: 6,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 14,
  },
});

export default DriverWorkAccountScreen;
