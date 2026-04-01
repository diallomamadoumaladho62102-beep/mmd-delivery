import React, { useCallback, useMemo, useState, useEffect, useRef } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ✅ A: vrai composant extrait
import { DriverAccountCard } from "../components/DriverAccountCard";

// ✅ IMPORTANT: clé rôle driver (alignée avec i18n/storage.ts)
const LOCALE_KEY = "mmd_locale_driver";

// ✅ Seulement 6 langues (comme dans i18n/index.ts)
const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
  ar: "العربية",
  zh: "中文",
  ff: "Pulaar",
};

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
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
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
      <View style={{ flex: 1, paddingRight: 10 }}>
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

      <Text
        style={{ color: danger ? "#FCA5A5" : "#93C5FD", fontWeight: "900" }}
      >
        {onPress ? "›" : ""}
      </Text>
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

// ✅ Normalise vers les 6 langues
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

// ✅ Typage minimal du profil driver (évite GenericStringError)
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

  // ✅ Langue dynamique (affichage) — suit i18n.language
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

  // ✅ quand la langue change → update immédiat de l’UI (même sans relire AsyncStorage)
  useEffect(() => {
    const next = normalizeLocale6(i18n.resolvedLanguage || i18n.language || "en");
    safeSetState(() => setLocale(next));
  }, [i18n.language, i18n.resolvedLanguage, safeSetState]);

  // ✅ optionnel: relire AsyncStorage pour montrer le code sauvegardé (compat)
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

      // ✅ resync Stripe status (soft)
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

      // ✅ FIX TS2339: caster proprement (GenericStringError -> DriverProfile)
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

      // ✅ Documents
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

      const docsScore =
        docsTotal > 0 ? Math.round((docsDone / docsTotal) * 50) : 0;
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
      loadLocaleFromStorage(); // ✅ optionnel (compat)
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

  // ✅ NEW: navigation Tax
  const goTax = useCallback(() => {
    navigation.navigate("DriverTax");
  }, [navigation]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
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

        {/* ✅ IMPORTANT: ce screen = "Driver account" (pas "Account") */}
        <Text style={{ color: "white", fontSize: 16, fontWeight: "900" }}>
          {t("driver.account.title", "Driver account")}
        </Text>

        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
      >
        <DriverAccountCard
          progress={safeProgress.progress}
          vehicleOk={safeProgress.vehicleOk}
          docsDone={safeProgress.docsDone}
          docsTotal={safeProgress.docsTotal}
          payoutOk={safeProgress.payoutOk}
          onPress={() => navigation.navigate("DriverWorkAccount")}
          onAction={() => navigation.navigate("DriverOnboarding")}
        />

        {/* ✅ Work section (comme ta capture) */}
        <Card
          title={t("driver.account.workTitle", "Work")}
          subtitle={t(
            "driver.account.workSubtitle",
            "What impacts your trips and earnings."
          )}
        >
          <Row
            label={t("driver.account.workCenter", "Work center")}
            value={t(
              "driver.account.workCenterHint",
              "Zone, preferences, availability"
            )}
            onPress={() => navigation.navigate("DriverWorkAccount")}
          />

          <Row
            label={t("driver.account.earnings", "Earnings")}
            value={t("driver.account.earningsHint", "History, payouts, cashouts")}
            onPress={() => navigation.navigate("DriverWallet")}
          />

          {/* ✅ NEW: Tax info -> DriverTax (plus d’Alert Bientôt) */}
          <Row
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
            label={t("common.security", "Security")}
            value={t("driver.settings.securityHint", "Change your password.")}
            onPress={() => navigation.navigate("DriverSecurity")}
          />

          <Row
            label={t("common.notifications", "Notifications")}
            value={t(
              "driver.settings.notificationsHint",
              "Manage notifications."
            )}
            onPress={() =>
              Alert.alert(
                t("common.soon", "Coming soon ✅"),
                t("driver.settings.notificationsSoon", "Coming soon ✅")
              )
            }
          />

          <Row
            label={t("common.language", "Language")}
            value={languageValue}
            onPress={() => navigation.navigate("DriverLanguage")}
          />
        </Card>

        <Card title={t("driver.settings.switchAccountTitle", "Switch account")}>
          {loading ? (
            <View
              style={{
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 10,
              }}
            >
              <ActivityIndicator />
              <Text style={{ color: "#9CA3AF", marginTop: 10 }}>
                {t("driver.settings.loggingOut", "Logging out…")}
              </Text>
            </View>
          ) : (
            <Row
              label={t("common.logout", "Log out")}
              value={t("driver.settings.logoutHint", "Log out of your account.")}
              onPress={onLogout}
              danger
            />
          )}
        </Card>

        <Text style={{ color: "#6B7280", marginTop: 6, fontWeight: "700" }}>
          {loadingProgress
            ? t("driver.settings.loadingFooter", "Loading…")
            : t("driver.settings.footer", "Need help? Contact support.")}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}