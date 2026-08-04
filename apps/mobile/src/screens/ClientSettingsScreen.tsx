import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import Constants from "expo-constants";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { SocialLinks } from "../components/shared/SocialLinks";
import { ClientHomeLanguageSheet } from "../components/client/home/ClientHomeLanguageSheet";
import { clearSelectedRole } from "../lib/authRole";
import {
  getLegalPrivacyUrl,
  getLegalTermsUrl,
  getSupportUrl,
  openLegalUrl,
} from "../lib/legalUrls";
import { setLocaleForRoleAndApply } from "../i18n";
import type { AppLanguageCode } from "../i18n/languageOptions";
import { supabase } from "../lib/supabase";
import { toUserFacingError } from "../lib/userFacingError";
import type { RootStackParamList } from "../navigation/AppNavigator";

type Nav = NativeStackNavigationProp<RootStackParamList, "ClientSettings">;

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function Row({
  label,
  value,
  onPress,
  danger,
  last,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
      disabled={!onPress}
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.row, last ? null : styles.rowBorder]}
    >
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, danger ? styles.danger : null]}>{label}</Text>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      </View>
      {onPress ? (
        <Text style={[styles.chevron, danger ? styles.danger : null]}>›</Text>
      ) : null}
    </TouchableOpacity>
  );
}

export function ClientSettingsScreen() {
  const navigation = useNavigation<Nav>();
  const { t, i18n } = useTranslation();
  const [langOpen, setLangOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const appVersion =
    Constants.expoConfig?.version ??
    Constants.nativeAppVersion ??
    "1.0.0";
  const platformLabel =
    Platform.OS === "ios" ? "iOS" : Platform.OS === "android" ? "Android" : Platform.OS;

  const currentLang = useMemo(() => {
    const raw = String(i18n.language || "en").toLowerCase();
    return raw.split("-")[0] || "en";
  }, [i18n.language]);

  const ts = useCallback(
    (key: string, fallback: string, params?: Record<string, unknown>) =>
      t(key, { defaultValue: fallback, ...(params ?? {}) }),
    [t]
  );

  const onChangeLang = useCallback(
    async (lang: AppLanguageCode) => {
      try {
        await setLocaleForRoleAndApply("client", lang);
      } catch {
        try {
          await i18n.changeLanguage(lang);
        } catch {
          Alert.alert(
            t("common.error", "Error"),
            t("client.home.errors.lang_change_failed", "Unable to change language right now.")
          );
        }
      }
    },
    [i18n, t]
  );

  const handleSignOut = useCallback(() => {
    Alert.alert(
      t("client.profile.signOut.title", "Sign Out"),
      t(
        "client.profile.signOut.body",
        "Sign out of this device? Your account and data stay intact."
      ),
      [
        { text: t("common.cancel", "Cancel"), style: "cancel" },
        {
          text: t("client.profile.signOut.confirm", "Sign Out"),
          style: "destructive",
          onPress: () => {
            void (async () => {
              setSigningOut(true);
              try {
                await clearSelectedRole();
                const { error } = await supabase.auth.signOut();
                if (error) throw error;
                navigation.reset({
                  index: 0,
                  routes: [{ name: "RoleSelect" }],
                });
              } catch (e) {
                Alert.alert(
                  t("common.error", "Error"),
                  toUserFacingError(
                    e,
                    t("client.profile.signOut.error", "Unable to sign out right now.")
                  )
                );
              } finally {
                setSigningOut(false);
              }
            })();
          },
        },
      ]
    );
  }, [navigation, t]);

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("client.settings.title", "Settings")}
        fallbackRoute="ClientHome"
        variant="dark"
      />

      <ScrollView contentContainerStyle={styles.content}>
        <Section title={t("client.settings.account", "Account")}>
          <Row
            label={t("client.settings.profile", "Profile")}
            onPress={() => navigation.navigate("ClientProfile")}
          />
          <Row
            label={t("client.settings.language", "Language")}
            value={currentLang.toUpperCase()}
            onPress={() => setLangOpen(true)}
          />
          <Row
            label={t("client.settings.notifications", "Notifications")}
            onPress={() => navigation.navigate("ClientNotificationCenter")}
            last
          />
        </Section>

        <Section title={t("client.settings.security", "Security")}>
          <Row
            label={t("client.settings.changePassword", "Change password")}
            onPress={() => navigation.navigate("ClientSecurity")}
            last
          />
        </Section>

        <Section title={t("client.settings.privacy", "Privacy")}>
          <Row
            label={t("legal.openPrivacy", "Privacy policy")}
            onPress={() => void openLegalUrl(getLegalPrivacyUrl())}
          />
          <Row
            label={t("legal.openTerms", "Terms of service")}
            onPress={() => void openLegalUrl(getLegalTermsUrl())}
          />
          <Row
            label={t("legal.openSupport", "Support")}
            onPress={() => void openLegalUrl(getSupportUrl())}
            last
          />
        </Section>

        <Section title={t("client.settings.danger", "Danger")}>
          <Row
            label={t("account.delete.title", "Delete account")}
            onPress={() => navigation.navigate("DeleteAccount", { role: "client" })}
            danger
          />
          <TouchableOpacity
            onPress={handleSignOut}
            disabled={signingOut}
            activeOpacity={0.85}
            style={[styles.row, styles.signOutRow]}
          >
            {signingOut ? (
              <ActivityIndicator color="#FCA5A5" />
            ) : (
              <Text style={[styles.rowLabel, styles.danger]}>
                {t("client.profile.signOut.button", "Sign Out")}
              </Text>
            )}
          </TouchableOpacity>
        </Section>

        <Section title={t("client.settings.about", "About")}>
          <Row
            label={t("client.settings.appVersion", "App version")}
            value={String(appVersion)}
          />
          <Row
            label={t("client.settings.platform", "Platform")}
            value={platformLabel}
            last
          />
        </Section>

        <Section title={t("client.settings.social", "Follow MMD Delivery")}>
          <View style={{ padding: 12 }}>
            <SocialLinks tone="dark" />
          </View>
        </Section>
      </ScrollView>

      <ClientHomeLanguageSheet
        visible={langOpen}
        currentLang={currentLang}
        onClose={() => setLangOpen(false)}
        onSelect={(lang) => {
          void onChangeLang(lang);
        }}
        ts={ts}
      />
    </SafeAreaView>
  );
}

export default ClientSettingsScreen;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#020617" },
  content: { padding: 16, paddingBottom: 40 },
  section: { marginBottom: 18 },
  sectionTitle: {
    color: "#94A3B8",
    fontWeight: "800",
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionCard: {
    backgroundColor: "#0B1220",
    borderColor: "#111827",
    borderWidth: 1,
    borderRadius: 16,
    overflow: "hidden",
  },
  row: {
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 52,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1E293B",
  },
  rowText: { flex: 1, paddingRight: 12 },
  rowLabel: { color: "#E5E7EB", fontWeight: "800", fontSize: 15 },
  rowValue: { color: "#94A3B8", fontWeight: "700", marginTop: 3, fontSize: 12 },
  chevron: { color: "#93C5FD", fontWeight: "900", fontSize: 20 },
  danger: { color: "#FCA5A5" },
  signOutRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#1E293B",
    justifyContent: "center",
  },
});
