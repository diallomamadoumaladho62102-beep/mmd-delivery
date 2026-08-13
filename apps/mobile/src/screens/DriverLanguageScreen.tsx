/**
 * Driver Language — UI aligned to Figma 294:6100.
 * Logic: setLocaleForRoleAndApply for the 6 supported locales.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  TextInput,
  ScrollView,
  StyleSheet,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { setLocaleForRoleAndApply } from "../i18n";
import {
  MMD_ACTION_NAVY,
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_STROKE,
  MMD_WHITE,
} from "../theme/mmdUi";

const MMD_LOGO = require("../../assets/brand/mmd-logo-ui.png");
const ROLE = "driver" as const;

type LangOption = {
  code: "en" | "fr" | "es" | "ar" | "zh" | "ff";
  label: string;
  nativeLabel: string;
  flag: string;
  note?: string;
};

const LANGUAGES: LangOption[] = [
  { code: "en", label: "English", nativeLabel: "English", flag: "🇬🇧" },
  { code: "fr", label: "French", nativeLabel: "Français", flag: "🇫🇷" },
  { code: "es", label: "Spanish", nativeLabel: "Español", flag: "🇪🇸" },
  { code: "ar", label: "Arabic", nativeLabel: "العربية", flag: "🇸🇦", note: "RTL" },
  { code: "zh", label: "Chinese", nativeLabel: "中文", flag: "🇨🇳" },
  { code: "ff", label: "Fulfulde", nativeLabel: "Fulfulde / Pulaar", flag: "🌍" },
];

function normalize(s: string) {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function DriverLanguageScreen() {
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation();

  const [locale, setLocale] = useState<string>("en");
  const [query, setQuery] = useState("");
  const savingRef = useRef(false);

  useEffect(() => {
    const lang = String(i18n.resolvedLanguage || i18n.language || "en")
      .trim()
      .toLowerCase();
    setLocale(lang || "en");
  }, [i18n.resolvedLanguage, i18n.language]);

  const current = useMemo(() => {
    const found = LANGUAGES.find((l) => l.code === locale);
    return found ?? LANGUAGES[0];
  }, [locale]);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return LANGUAGES;
    return LANGUAGES.filter((l) => {
      return (
        normalize(l.nativeLabel).includes(q) ||
        normalize(l.label).includes(q) ||
        normalize(l.code).includes(q)
      );
    });
  }, [query]);

  const save = useCallback(
    async (next: LangOption["code"]) => {
      const prev = locale;
      if (!next || next === prev) return;
      if (savingRef.current) return;
      savingRef.current = true;

      try {
        setLocale(next);
        await setLocaleForRoleAndApply(ROLE, next);
        const found = LANGUAGES.find((l) => l.code === next);
        const msg = found
          ? `${t("common.language")}: ${found.nativeLabel} (${found.code})`
          : `${t("common.language")}: ${next}`;
        Alert.alert(t("common.ok"), msg, [
          { text: t("common.ok"), onPress: () => navigation.goBack() },
        ]);
      } catch (e: any) {
        console.log("save locale error:", e);
        setLocale(prev);
        Alert.alert(
          t("common.errorTitle", "Error"),
          e?.message ?? "Unable to change language.",
        );
      } finally {
        savingRef.current = false;
      }
    },
    [locale, navigation, t],
  );

  return (
    <SafeAreaView style={styles.root} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("common.language")}
        subtitle={`${current.nativeLabel} (${current.code})`}
        fallbackRoute="DriverTabs"
        variant="mmd"
      />

      <View style={styles.body}>
        <View style={styles.card}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("driver.language.searchPlaceholder", "Search language...")}
            placeholderTextColor="rgba(255,255,255,0.8)"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.search}
          />

          <ScrollView showsVerticalScrollIndicator={false}>
            {filtered.map((item) => {
              const active = locale === item.code;
              return (
                <TouchableOpacity
                  key={item.code}
                  onPress={() => void save(item.code)}
                  activeOpacity={0.9}
                  style={[styles.langRow, active && styles.langRowActive]}
                >
                  <Text style={styles.flag}>{item.flag}</Text>
                  <View style={styles.langLabels}>
                    <Text style={styles.langNative}>{item.nativeLabel}</Text>
                    <Text style={styles.langMeta}>
                      {item.label} • {item.code.toUpperCase()}
                      {item.note ? ` • ${item.note}` : ""}
                    </Text>
                  </View>
                  {active ? <Text style={styles.check}>✓</Text> : null}
                </TouchableOpacity>
              );
            })}

            <View style={styles.note}>
              <Text style={styles.noteText}>
                {t(
                  "driver.language.supportedNote",
                  "✅ Only the 6 supported languages are shown here.",
                )}
              </Text>
            </View>

            <View style={styles.logoBlock}>
              <Image
                source={MMD_LOGO}
                style={styles.logo}
                resizeMode="contain"
                accessibilityLabel="MMD Delivery"
              />
              <Text style={styles.logoLabel}>MMD Delivery</Text>
            </View>
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MMD_BLUE },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 20 },
  card: {
    flex: 1,
    backgroundColor: MMD_BLUE,
    borderWidth: 1,
    borderColor: MMD_STROKE,
    borderRadius: 22,
    padding: 14,
    gap: 10,
  },
  search: {
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: MMD_STROKE,
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: MMD_WHITE,
    fontFamily: MMD_FONT.regular,
    fontSize: 14,
  },
  langRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: MMD_ACTION_NAVY,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  langRowActive: {
    borderColor: MMD_WHITE,
  },
  flag: { fontSize: 20 },
  langLabels: { flex: 1, minWidth: 0 },
  langNative: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 15,
  },
  langMeta: {
    color: "rgba(255,255,255,0.8)",
    fontFamily: MMD_FONT.regular,
    fontSize: 12,
    marginTop: 2,
  },
  check: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 16,
  },
  note: {
    marginTop: 6,
    padding: 12,
    borderRadius: 16,
    backgroundColor: MMD_BLUE,
    borderWidth: 1,
    borderColor: MMD_STROKE,
  },
  noteText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 12,
    lineHeight: 18,
  },
  logoBlock: {
    alignItems: "center",
    paddingTop: 16,
    paddingBottom: 8,
    gap: 8,
  },
  logo: { width: 56, height: 56, borderRadius: 14 },
  logoLabel: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 13,
  },
});

export default DriverLanguageScreen;
