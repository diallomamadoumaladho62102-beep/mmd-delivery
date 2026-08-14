/**
 * Driver Account — UI aligned to Figma 294:6021.
 * Logic/APIs preserved (setup progress, locale, logout).
 */
import React, { useCallback, useMemo, useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { clearSelectedRole } from "../lib/authRole";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DriverAccountCard } from "../components/DriverAccountCard";
import ScreenHeader from "../components/navigation/ScreenHeader";
import DriverBrandLoadingState from "../components/driver/DriverBrandLoadingState";
import { toUserFacingError } from "../lib/userFacingError";
import { computeDriverSetupProgress } from "../lib/driverSetupProgress";
import {
  MMD_ACTION_NAVY,
  MMD_BLUE,
  MMD_FONT,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../theme/mmdUi";

const LOCALE_KEY = "mmd_locale_driver";
const DANGER = "#F87171";

const LOCALE_LABELS: Record<string, string> = {
  en: "English (US)",
  fr: "Français",
  es: "Español",
  ar: "العربية",
  zh: "中文",
  ff: "Pulaar",
};

type DriverProgress = {
  progress: number;
  vehicleOk: boolean;
  docsDone: number;
  docsTotal: number;
  payoutOk: boolean;
};

type DriverProfile = {
  id?: string | null;
  user_id?: string | null;
  transport_mode?: string | null;
  active_vehicle_id?: string | null;
  stripe_account_id?: string | null;
  stripe_onboarded?: boolean | null;
  status?: string | null;
};

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

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function MenuRow({
  icon,
  iconBg,
  label,
  value,
  onPress,
  danger,
  showChevron = true,
}: {
  icon: string;
  iconBg: string;
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  showChevron?: boolean;
}) {
  return (
    <TouchableOpacity
      disabled={!onPress}
      onPress={onPress}
      style={styles.menuRow}
      activeOpacity={0.86}
    >
      <View style={[styles.menuIcon, { backgroundColor: iconBg }]}>
        <Text style={styles.menuEmoji}>{icon}</Text>
      </View>
      <View style={styles.menuText}>
        <Text style={[styles.menuLabel, danger && styles.dangerText]}>{label}</Text>
        {value ? <Text style={styles.menuValue}>{value}</Text> : null}
      </View>
      {showChevron && onPress ? <Text style={styles.chevron}>›</Text> : null}
    </TouchableOpacity>
  );
}

export function DriverAccountScreen() {
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation();

  const [loading, setLoading] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [accountStatus, setAccountStatus] = useState<string | null>(null);
  const [p, setP] = useState<DriverProgress>({
    progress: 0,
    vehicleOk: false,
    docsDone: 0,
    docsTotal: 4,
    payoutOk: false,
  });
  const [loadingProgress, setLoadingProgress] = useState(true);
  const [locale, setLocale] = useState<string>(() =>
    normalizeLocale6(i18n.resolvedLanguage || i18n.language || "en"),
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
        Alert.alert(
          t("common.errorTitle", "Error"),
          toUserFacingError(authErr, t("common.errorTitle", "Error")),
        );
        return;
      }

      const uid = authRes.user?.id;
      if (!uid) {
        Alert.alert(
          t("common.errorTitle", "Error"),
          t("common.notConfigured", "Not configured"),
        );
        return;
      }

      try {
        const { error: syncErr } = await supabase.functions.invoke(
          "check_connect_status",
          { body: { role: "driver" } },
        );
        if (syncErr) console.log("check_connect_status error:", syncErr);
      } catch (e) {
        console.log("check_connect_status exception:", e);
      }

      const profileRes = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", uid)
        .maybeSingle();
      if (profileRes.data?.full_name) {
        safeSetState(() => setDisplayName(String(profileRes.data.full_name)));
      } else if (authRes.user?.email) {
        safeSetState(() => setDisplayName(String(authRes.user?.email)));
      }

      let { data: profileRaw, error: pErr } = await supabase
        .from("driver_profiles")
        .select(
          "id,user_id,transport_mode,active_vehicle_id,stripe_account_id,stripe_onboarded,status",
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
            stripe_onboarded: false,
          } as any,
          { onConflict: "id" },
        );

        if (upErr) {
          Alert.alert(
            t("common.errorTitle", "Error"),
            toUserFacingError(
              upErr,
              t(
                "driver.account.createProfileFailed",
                "Unable to create the driver profile right now.",
              ),
            ),
          );
        }

        const again = await supabase
          .from("driver_profiles")
          .select(
            "id,user_id,transport_mode,active_vehicle_id,stripe_account_id,stripe_onboarded,status",
          )
          .or(`user_id.eq.${uid},id.eq.${uid}`)
          .maybeSingle();

        profileRaw = again.data ?? null;
        pErr = again.error ?? null;
      }

      if (pErr) {
        Alert.alert(
          t("common.errorTitle", "Error"),
          toUserFacingError(
            pErr,
            t(
              "driver.account.loadProfileFailed",
              "Unable to load the driver profile right now.",
            ),
          ),
        );
      }

      const dp = (profileRaw as unknown as DriverProfile | null) ?? null;
      safeSetState(() => setAccountStatus(dp?.status ?? null));

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
          Alert.alert(
            t("common.errorTitle", "Error"),
            toUserFacingError(
              second.error,
              t(
                "driver.account.loadDocsFailed",
                "Unable to load documents right now.",
              ),
            ),
          );
        } else {
          docs = second.data ?? [];
        }
      }

      const computed = computeDriverSetupProgress({
        profile: {
          transport_mode: dp?.transport_mode,
          active_vehicle_id: dp?.active_vehicle_id,
          stripe_onboarded: dp?.stripe_onboarded,
        },
        docs,
      });

      setP({
        progress: computed.progress,
        vehicleOk: computed.vehicleOk,
        docsDone: computed.docsDone,
        docsTotal: computed.docsTotal,
        payoutOk: computed.payoutOk,
      });
    } catch (e: any) {
      console.log("loadProgress error", e);
      Alert.alert(
        t("common.errorTitle", "Error"),
        e?.message ??
          t("driver.account.loadStatusFailed", "Unable to load account status."),
      );
    } finally {
      setLoadingProgress(false);
    }
  }, [safeSetState, t]);

  useFocusEffect(
    useCallback(() => {
      loadProgress();
      loadLocaleFromStorage();
    }, [loadProgress, loadLocaleFromStorage]),
  );

  const onLogout = useCallback(async () => {
    try {
      setLoading(true);
      await clearSelectedRole();
      const { error } = await supabase.auth.signOut();
      if (error) {
        Alert.alert(
          t("common.errorTitle", "Error"),
          toUserFacingError(
            error,
            t(
              "driver.account.logoutFailed",
              "Something went wrong temporarily. Please try again.",
            ),
          ),
        );
        return;
      }
      navigation.reset({
        index: 0,
        routes: [{ name: "RoleSelect" }],
      });
    } finally {
      setLoading(false);
    }
  }, [navigation, t]);

  const onSwitchAccount = useCallback(async () => {
    try {
      setLoading(true);
      await clearSelectedRole();
      navigation.reset({
        index: 0,
        routes: [{ name: "RoleSelect" }],
      });
    } finally {
      setLoading(false);
    }
  }, [navigation]);

  const safeProgress = useMemo(() => p, [p]);

  const languageValue = useMemo(() => {
    const code = normalizeLocale6(locale || "en");
    return LOCALE_LABELS[code] || code.toUpperCase();
  }, [locale]);

  const isActive = useMemo(() => {
    const s = String(accountStatus || "").toLowerCase();
    if (s === "active" || s === "approved" || s === "verified") return true;
    return safeProgress.progress >= 100;
  }, [accountStatus, safeProgress.progress]);

  const nameLabel =
    displayName.trim() ||
    t("driver.account.unnamed", "Driver");

  if (loadingProgress && !displayName) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
        <ScreenHeader
          title={t("driver.account.title", "Driver account")}
          fallbackRoute="DriverTabs"
          variant="mmd"
          showBack={false}
        />
        <DriverBrandLoadingState
          title={t("common.loading", "Loading…")}
          logoAtBottom={false}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("driver.account.title", "Driver account")}
        fallbackRoute="DriverTabs"
        variant="mmd"
        showBack={false}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileCard}>
          <View style={styles.profileRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initialsFromName(nameLabel)}</Text>
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.profileName} numberOfLines={1}>
                {nameLabel}
              </Text>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: isActive ? MMD_TAXI_GREEN : "#F59E0B" },
                ]}
              >
                <Text style={styles.statusBadgeText}>
                  {isActive
                    ? t("driver.account.statusActive", "Active")
                    : t("driver.account.statusIncomplete", "Incomplete")}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <DriverAccountCard
          progress={safeProgress.progress}
          vehicleOk={safeProgress.vehicleOk}
          docsDone={safeProgress.docsDone}
          docsTotal={safeProgress.docsTotal}
          payoutOk={safeProgress.payoutOk}
          guidedActive={isActive}
          onPress={() => navigation.navigate("DriverWorkAccount")}
          onAction={() => {
            if (!safeProgress.vehicleOk) {
              navigation.navigate("DriverVehicles");
              return;
            }
            if (!safeProgress.payoutOk) {
              navigation.navigate("DriverWallet");
              return;
            }
            navigation.navigate("DriverProfile");
          }}
        />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t("driver.account.workTitle", "Work").toUpperCase()}
          </Text>
          <View style={styles.sectionStack}>
            <MenuRow
              icon="📍"
              iconBg="#E0E7FF"
              label={t("driver.account.zonePrefs", "Zone & Preferences")}
              value={t(
                "driver.account.zonePrefsHint",
                "Availability and service area",
              )}
              onPress={() => navigation.navigate("DriverServices")}
            />
            <MenuRow
              icon="💰"
              iconBg="#E0E7FF"
              label={t("driver.account.earnings", "Earnings")}
              value={t(
                "driver.account.earningsHint",
                "History, payouts, and cashouts",
              )}
              onPress={() => navigation.navigate("DriverWallet")}
            />
            <MenuRow
              icon="📄"
              iconBg="#E0E7FF"
              label={t("driver.account.taxInfo", "Tax Info (W-9 / 1099)")}
              value={t("driver.account.taxHint", "Fiscal documentation")}
              onPress={() => navigation.navigate("DriverTax")}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t("common.account", "Account").toUpperCase()}
          </Text>
          <View style={styles.sectionStack}>
            <MenuRow
              icon="🛡️"
              iconBg="#E0E7FF"
              label={t("common.security", "Security")}
              value={t(
                "driver.settings.securityHint",
                "Manage your account security",
              )}
              onPress={() => navigation.navigate("DriverSecurity")}
            />
            <MenuRow
              icon="🔒"
              iconBg="#E0E7FF"
              label={t("driver.account.changePassword", "Change Password")}
              value={t(
                "driver.account.changePasswordHint",
                "Update your login credentials",
              )}
              onPress={() => navigation.navigate("DriverSecurity")}
            />
            <MenuRow
              icon="🗑️"
              iconBg="#FEE2E2"
              label={t("account.delete.title", "Delete Account")}
              value={t(
                "account.delete.rowHint",
                "Permanently remove your account",
              )}
              onPress={() =>
                navigation.navigate("DeleteAccount", { role: "driver" })
              }
              danger
              showChevron={false}
            />
            <MenuRow
              icon="🌐"
              iconBg="#E0E7FF"
              label={t("common.language", "Language")}
              value={languageValue}
              onPress={() => navigation.navigate("DriverLanguage")}
            />
          </View>
        </View>

        <View style={styles.sectionStack}>
          <MenuRow
            icon="🔄"
            iconBg="#E0E7FF"
            label={t("driver.settings.switchAccountTitle", "Switch account")}
            onPress={onSwitchAccount}
            showChevron={false}
          />
          <MenuRow
            icon="🚪"
            iconBg="#FEE2E2"
            label={
              loading
                ? t("driver.settings.loggingOut", "Logging out…")
                : t("common.logout", "Log out")
            }
            onPress={onLogout}
            danger
            showChevron={false}
          />
        </View>

        <TouchableOpacity
          style={styles.helpCard}
          activeOpacity={0.86}
          onPress={() => navigation.navigate("DriverHelp")}
        >
          <View style={styles.helpLeft}>
            <View style={styles.helpIcon}>
              <Text style={styles.menuEmoji}>🎧</Text>
            </View>
            <View>
              <Text style={styles.helpTitle}>
                {t("driver.account.needHelp", "Need Help?")}
              </Text>
              <Text style={styles.helpSub}>
                {t(
                  "driver.account.needHelpHint",
                  "Contact our support team",
                )}
              </Text>
            </View>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  content: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 40,
    gap: 24,
  },
  profileCard: {
    backgroundColor: MMD_ACTION_NAVY,
    borderRadius: 16,
    padding: 16,
  },
  profileRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 2,
    borderColor: MMD_WHITE,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 20,
  },
  profileInfo: { flex: 1, minWidth: 0, gap: 6 },
  profileName: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 18,
  },
  statusBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusBadgeText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 12,
  },
  section: { gap: 12 },
  sectionTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 14,
  },
  sectionStack: { gap: 12 },
  menuRow: {
    backgroundColor: MMD_ACTION_NAVY,
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  menuIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  menuEmoji: { fontSize: 24 },
  menuText: { flex: 1, minWidth: 0, gap: 2 },
  menuLabel: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 15,
  },
  menuValue: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 13,
  },
  chevron: {
    color: MMD_WHITE,
    fontSize: 20,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  dangerText: { color: DANGER },
  helpCard: {
    backgroundColor: MMD_ACTION_NAVY,
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  helpLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  helpIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  helpTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 16,
  },
  helpSub: {
    color: MMD_WHITE,
    opacity: 0.9,
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
    marginTop: 2,
  },
});

export default DriverAccountScreen;
