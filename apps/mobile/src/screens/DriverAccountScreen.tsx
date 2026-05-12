import React, { useCallback, useMemo, useState, useEffect, useRef } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DriverAccountCard } from "../components/DriverAccountCard";

const LOCALE_KEY = "mmd_locale_driver";

const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
  ar: "العربية",
  zh: "中文",
  ff: "Pulaar",
};

const BG = "#020617";
const CARD = "rgba(15,23,42,0.88)";
const CARD_SOFT = "rgba(2,6,23,0.74)";
const BORDER = "rgba(148,163,184,0.14)";
const PURPLE = "#A78BFA";
const PURPLE_DARK = "#8B5CF6";
const GREEN = "#22C55E";
const RED = "#FCA5A5";
const TEXT = "#F8FAFC";
const MUTED = "#94A3B8";

type AccountIconName =
  | "work"
  | "earnings"
  | "tax"
  | "security"
  | "notification"
  | "language"
  | "logout";

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
      <View style={styles.cardBody}>{children}</View>
    </View>
  );
}

function Row({
  label,
  value,
  onPress,
  danger,
  icon,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  icon: AccountIconName;
}) {
  return (
    <TouchableOpacity
      disabled={!onPress}
      onPress={onPress}
      style={[styles.row, danger && styles.rowDanger, !onPress && { opacity: 0.9 }]}
      activeOpacity={0.86}
    >
      <View style={styles.rowLeft}>
        <View style={[styles.rowIconBox, danger && styles.rowIconDanger]}>
          <AccountIcon name={icon} danger={danger} />
        </View>

        <View style={styles.rowTextWrap}>
          <Text style={[styles.rowLabel, danger && styles.dangerText]}>{label}</Text>
          {value ? <Text style={styles.rowValue}>{value}</Text> : null}
        </View>
      </View>

      <Text style={[styles.chevron, danger && styles.dangerText]}>{onPress ? "›" : ""}</Text>
    </TouchableOpacity>
  );
}

type DriverProgress = {
  progress: number;
  vehicleOk: boolean;
  docsDone: number;
  docsTotal: number;
  payoutOk: boolean;
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

function isBike(tm: any) {
  const x = normMode(tm);
  return x === "bike" || x === "velo";
}

function needsVehicleDetails(tm: any) {
  const x = normMode(tm);
  return x === "car" || x === "moto" || x === "motorcycle" || x === "scooter";
}

function normalizeLocale6(locale: string) {
  const x = String(locale || "").trim().toLowerCase();
  if (x.startsWith("zh")) return "zh";
  if (x.startsWith("ar")) return "ar";
  if (x.startsWith("es")) return "es";
  if (x.startsWith("fr")) return "fr";
  if (x.startsWith("en")) return "en";
  if (x.startsWith("ff")) return "ff";
  return x;
}

type DriverProfile = {
  id?: string | null;
  user_id?: string | null;
  transport_mode?: string | null;
  vehicle_brand?: string | null;
  vehicle_model?: string | null;
  vehicle_year?: number | null;
  plate_number?: string | null;
  vehicle_verified?: boolean | null;
  payout_enabled?: boolean | null;
  stripe_account_id?: string | null;
  stripe_onboarded?: boolean | null;
};

export function DriverAccountScreen() {
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation();

  const [loading, setLoading] = useState(false);
  const [p, setP] = useState<DriverProgress>({
    progress: 0,
    vehicleOk: false,
    docsDone: 0,
    docsTotal: REQUIRED_DOCS.length,
    payoutOk: false,
  });
  const [loadingProgress, setLoadingProgress] = useState(false);
  const [locale, setLocale] = useState<string>(() =>
    normalizeLocale6(i18n.resolvedLanguage || i18n.language || "en")
  );

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const safeSetState = useCallback((fn: () => void) => {
    if (mountedRef.current) fn();
  }, []);

  useEffect(() => {
    const next = normalizeLocale6(i18n.resolvedLanguage || i18n.language || "en");
    safeSetState(() => setLocale(next));
  }, [i18n.language, i18n.resolvedLanguage, safeSetState]);

  const loadLocaleFromStorage = useCallback(async () => {
    try {
      const v = await AsyncStorage.getItem(LOCALE_KEY);
      if (typeof v === "string" && v.trim()) {
        const next = normalizeLocale6(v.trim());
        safeSetState(() => setLocale(next));
      }
    } catch (e) {
      console.log("loadLocale error:", e);
    }
  }, [safeSetState]);

  const loadProgress = useCallback(async () => {
    try {
      setLoadingProgress(true);

      const { data: authRes, error: authErr } = await supabase.auth.getUser();
      if (authErr) {
        Alert.alert(t("common.errorTitle", "Error"), authErr.message);
        return;
      }

      const uid = authRes.user?.id;
      if (!uid) {
        Alert.alert(
          t("common.errorTitle", "Error"),
          t("common.notConfigured", "Not configured")
        );
        return;
      }

      try {
        const { error: syncErr } = await supabase.functions.invoke(
          "check_connect_status"
        );
        if (syncErr) console.log("check_connect_status error:", syncErr);
      } catch (e) {
        console.log("check_connect_status exception:", e);
      }

      let { data: profileRaw, error: pErr } = await supabase
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
            "vehicle_verified",
            "payout_enabled",
            "stripe_account_id",
            "stripe_onboarded",
          ].join(",")
        )
        .or(`user_id.eq.${uid},id.eq.${uid}`)
        .maybeSingle();

      if (!profileRaw) {
        const { error: upErr } = await supabase.from("driver_profiles").upsert(
          {
            id: uid,
            user_id: uid,
            transport_mode: "bike",
            is_online: false,
            total_deliveries: 0,
            acceptance_rate: 0,
            cancellation_rate: 0,
            vehicle_verified: false,
            payout_enabled: false,
          } as any,
          { onConflict: "id" }
        );

        if (upErr) {
          Alert.alert("driver_profiles", `Upsert blocked: ${upErr.message}`);
        }

        const again = await supabase
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
              "vehicle_verified",
              "payout_enabled",
              "stripe_account_id",
              "stripe_onboarded",
            ].join(",")
          )
          .or(`user_id.eq.${uid},id.eq.${uid}`)
          .maybeSingle();

        profileRaw = again.data ?? null;
        pErr = again.error ?? null;
      }

      if (pErr) {
        Alert.alert("driver_profiles", pErr.message);
      }

      const dp = (profileRaw as unknown as DriverProfile | null) ?? null;
      const tm = dp?.transport_mode ?? "bike";
      const bike = isBike(tm);
      const needsVehicle = needsVehicleDetails(tm);

      const vehicleOk = !needsVehicle
        ? true
        : Boolean(
            String(dp?.vehicle_brand ?? "").trim() &&
              String(dp?.vehicle_model ?? "").trim() &&
              Number(dp?.vehicle_year ?? 0) > 1900 &&
              String(dp?.plate_number ?? "").trim()
          );

      const stripeOnboarded = Boolean(dp?.stripe_onboarded);
      const payoutEnabledFallback = Boolean(dp?.payout_enabled);
      const payoutOk = stripeOnboarded || payoutEnabledFallback;

      let docsDone = 0;
      let docsTotal = 0;

      if (bike) {
        docsDone = 1;
        docsTotal = 1;
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
            Alert.alert("driver_documents", second.error.message);
          } else {
            docs = second.data ?? [];
          }
        }

        const approved = new Set(
          (docs ?? [])
            .filter((x: any) => (x?.status ? x?.status === "approved" : true))
            .map((x: any) => String(x.doc_type))
        );

        docsDone = REQUIRED_DOCS.filter((tt) => approved.has(tt)).length;
        docsTotal = REQUIRED_DOCS.length;
      }

      const docsScore = docsTotal > 0 ? Math.round((docsDone / docsTotal) * 50) : 0;
      const score = (vehicleOk ? 25 : 0) + docsScore + (payoutOk ? 25 : 0);

      setP({
        progress: Math.max(0, Math.min(100, score)),
        vehicleOk,
        docsDone,
        docsTotal,
        payoutOk,
      });
    } catch (e: any) {
      console.log("loadProgress error", e);
      Alert.alert(
        t("common.errorTitle", "Error"),
        e?.message ?? "Unable to load account status."
      );
    } finally {
      setLoadingProgress(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      loadProgress();
      loadLocaleFromStorage();
    }, [loadProgress, loadLocaleFromStorage])
  );

  const onLogout = useCallback(async () => {
    try {
      setLoading(true);

      const { error } = await supabase.auth.signOut();
      if (error) {
        Alert.alert(t("common.errorTitle", "Error"), error.message);
        return;
      }

      navigation.reset({
        index: 0,
        routes: [{ name: "DriverAuth" }],
      });
    } finally {
      setLoading(false);
    }
  }, [navigation, t]);

  const safeProgress = useMemo(() => p, [p]);

  const languageValue = useMemo(() => {
    const code = normalizeLocale6(locale || "en");
    const name = LOCALE_LABELS[code] || code.toUpperCase();
    return `🌐 ${name} (${code})`;
  }, [locale]);

  const goTax = useCallback(() => {
    navigation.navigate("DriverTax");
  }, [navigation]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} activeOpacity={0.85}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>

        <Text style={styles.headerTitle}>{t("driver.account.title", "Driver account")}</Text>

        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.progressCardWrap}>
          <DriverAccountCard
            progress={safeProgress.progress}
            vehicleOk={safeProgress.vehicleOk}
            docsDone={safeProgress.docsDone}
            docsTotal={safeProgress.docsTotal}
            payoutOk={safeProgress.payoutOk}
            onPress={() => navigation.navigate("DriverWorkAccount")}
            onAction={() => navigation.navigate("DriverOnboarding")}
          />
        </View>

        <Card
          title={t("driver.account.workTitle", "Work")}
          subtitle={t(
            "driver.account.workSubtitle",
            "What impacts your trips and earnings."
          )}
        >
          <Row
            icon="work"
            label={t("driver.account.workCenter", "Work center")}
            value={t("driver.account.workCenterHint", "Zone, preferences, availability")}
            onPress={() => navigation.navigate("DriverWorkAccount")}
          />

          <Row
            icon="earnings"
            label={t("driver.account.earnings", "Earnings")}
            value={t("driver.account.earningsHint", "History, payouts, cashouts")}
            onPress={() => navigation.navigate("DriverWallet")}
          />

          <Row
            icon="tax"
            label={t("driver.account.taxInfo", "Tax info")}
            value={t("driver.account.taxHint", "W-9 / 1099 (later)")}
            onPress={goTax}
          />
        </Card>

        <Card
          title={t("common.account", "Account")}
          subtitle={t("driver.settings.subtitle", "Manage your driver account.")}
        >
          <Row
            icon="security"
            label={t("common.security", "Security")}
            value={t("driver.settings.securityHint", "Change your password.")}
            onPress={() => navigation.navigate("DriverSecurity")}
          />

          <Row
            icon="notification"
            label={t("common.notifications", "Notifications")}
            value={t("driver.settings.notificationsHint", "Manage notifications.")}
            onPress={() =>
              Alert.alert(
                t("common.soon", "Coming soon ✅"),
                t("driver.settings.notificationsSoon", "Coming soon ✅")
              )
            }
          />

          <Row
            icon="language"
            label={t("common.language", "Language")}
            value={languageValue}
            onPress={() => navigation.navigate("DriverLanguage")}
          />
        </Card>

        <Card title={t("driver.settings.switchAccountTitle", "Switch account")}>
          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={PURPLE} />
              <Text style={styles.loadingText}>{t("driver.settings.loggingOut", "Logging out…")}</Text>
            </View>
          ) : (
            <Row
              icon="logout"
              label={t("common.logout", "Log out")}
              value={t("driver.settings.logoutHint", "Log out of your account.")}
              onPress={onLogout}
              danger
            />
          )}
        </Card>

        <Text style={styles.footerText}>
          {loadingProgress
            ? t("driver.settings.loadingFooter", "Loading…")
            : t("driver.settings.footer", "Need help? Contact support.")}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function AccountIcon({ name, danger }: { name: AccountIconName; danger?: boolean }) {
  const color = danger ? RED : PURPLE;

  if (name === "earnings") {
    return <Text style={[styles.iconGlyph, { color }]}>$</Text>;
  }

  if (name === "tax") {
    return <Text style={[styles.iconGlyph, { color, fontSize: 18 }]}>%</Text>;
  }

  if (name === "language") {
    return <Text style={[styles.iconGlyph, { color, fontSize: 17 }]}>文</Text>;
  }

  if (name === "notification") {
    return (
      <View style={styles.bellIcon}>
        <View style={[styles.bellTop, { borderColor: color }]} />
        <View style={[styles.bellBody, { borderColor: color }]} />
        <View style={[styles.bellClapper, { backgroundColor: color }]} />
      </View>
    );
  }

  if (name === "security") {
    return (
      <View style={styles.shieldIcon}>
        <View style={[styles.shieldShape, { borderColor: color }]} />
      </View>
    );
  }

  if (name === "logout") {
    return <Text style={[styles.iconGlyph, { color, fontSize: 20 }]}>↪</Text>;
  }

  return (
    <View style={styles.workIcon}>
      <View style={[styles.workCase, { borderColor: color }]} />
      <View style={[styles.workHandle, { borderColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 8,
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: CARD_SOFT,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: {
    color: "#BFDBFE",
    fontSize: 34,
    fontWeight: "700",
    marginTop: -2,
  },
  headerTitle: {
    color: TEXT,
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  headerSpacer: {
    width: 44,
    height: 44,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 30,
  },
  progressCardWrap: {
    marginBottom: 16,
    borderRadius: 26,
    overflow: "hidden",
    shadowColor: PURPLE_DARK,
    shadowOpacity: 0.14,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  card: {
    borderRadius: 26,
    padding: 15,
    marginBottom: 16,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  cardTitle: {
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
  },
  cardSubtitle: {
    color: MUTED,
    fontWeight: "800",
    marginTop: 6,
    lineHeight: 18,
  },
  cardBody: {
    marginTop: 12,
  },
  row: {
    minHeight: 72,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: CARD_SOFT,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.11)",
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowDanger: {
    borderColor: "rgba(252,165,165,0.2)",
    backgroundColor: "rgba(127,29,29,0.14)",
  },
  rowLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
  },
  rowIconBox: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: "rgba(139,92,246,0.14)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  rowIconDanger: {
    backgroundColor: "rgba(239,68,68,0.12)",
  },
  rowTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    color: TEXT,
    fontSize: 15,
    fontWeight: "900",
  },
  rowValue: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 4,
  },
  chevron: {
    color: "#CBD5E1",
    fontSize: 28,
    fontWeight: "600",
    marginLeft: 10,
    marginTop: -2,
  },
  dangerText: {
    color: RED,
  },
  loadingBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  loadingText: {
    color: MUTED,
    marginTop: 10,
    fontWeight: "800",
  },
  footerText: {
    color: "#64748B",
    marginTop: 2,
    fontWeight: "800",
    paddingHorizontal: 4,
  },
  iconGlyph: {
    color: PURPLE,
    fontSize: 21,
    fontWeight: "900",
  },
  workIcon: {
    width: 25,
    height: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  workHandle: {
    position: "absolute",
    top: 2,
    width: 11,
    height: 7,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    borderWidth: 2,
    borderBottomWidth: 0,
  },
  workCase: {
    position: "absolute",
    bottom: 2,
    width: 23,
    height: 16,
    borderRadius: 5,
    borderWidth: 2,
  },
  shieldIcon: {
    width: 24,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  shieldShape: {
    width: 20,
    height: 22,
    borderRadius: 7,
    borderWidth: 2,
    transform: [{ rotate: "45deg" }],
  },
  bellIcon: {
    width: 24,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  bellTop: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "transparent",
    borderWidth: 2,
    marginBottom: -2,
  },
  bellBody: {
    width: 18,
    height: 15,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderBottomLeftRadius: 5,
    borderBottomRightRadius: 5,
    borderWidth: 2,
  },
  bellClapper: {
    width: 6,
    height: 3,
    borderRadius: 3,
    marginTop: 2,
  },
});
