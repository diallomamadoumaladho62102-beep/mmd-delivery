/**
 * Restaurant Language — Figma 348:7241 Premium Glass.
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
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { setLocaleForRoleAndApply } from "../i18n";
import ScreenHeader from "../components/navigation/ScreenHeader";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GLASS,
  MMD_GOLD_CLASSIC,
  MMD_WHITE,
} from "../theme/mmdUi";

const MMD_LOGO = require("../../assets/brand/mmd-logo-ui.png");
const ROLE = "restaurant" as const;
const SELECT_GREEN = "#10B981";

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

export function RestaurantLanguageScreen() {
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
          ? `${t("common.language", "Language")}: ${found.nativeLabel} (${found.code})`
          : `${t("common.language", "Language")}: ${next}`;
        Alert.alert(t("common.ok", "OK"), msg, [
          { text: t("common.ok", "OK"), onPress: () => navigation.goBack() },
        ]);
      } catch (e: any) {
        console.log("restaurant save locale error:", e);
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
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={t("common.language", "Language")}
        subtitle="MMD Delivery"
        fallbackRoute="RestaurantCommandCenter"
        variant="mmd"
        rightSlot={
          <Image
            source={MMD_LOGO}
            style={styles.headerLogo}
            resizeMode="contain"
            accessibilityLabel="MMD Delivery"
          />
        }
      />

      <View style={styles.body}>
        <Text style={styles.hint}>
          {t("restaurant.language.chooseHint", "Choose your app language")}
        </Text>

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t(
            "restaurant.language.searchPlaceholder",
            "Search (English, Français, Español...)",
          )}
          placeholderTextColor="rgba(255,255,255,0.45)"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.search}
        />

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
          {filtered.map((item) => {
            const active = locale === item.code;
            return (
              <TouchableOpacity
                key={item.code}
                onPress={() => void save(item.code)}
                activeOpacity={0.9}
                style={[styles.option, active && styles.optionActive]}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
              >
                {active ? <View style={styles.selectionBar} /> : null}
                <View style={styles.flagPill}>
                  <Text style={styles.flag}>{item.flag}</Text>
                </View>
                <View style={styles.labels}>
                  <Text style={styles.label}>{item.label}</Text>
                  <Text style={styles.native}>
                    {item.nativeLabel}
                    {item.note ? ` • ${item.note}` : ""}
                  </Text>
                </View>
                {active ? (
                  <View style={styles.radioSelected}>
                    <Ionicons name="checkmark" size={14} color={MMD_WHITE} />
                  </View>
                ) : (
                  <View style={styles.radio} />
                )}
              </TouchableOpacity>
            );
          })}

          <View style={styles.note}>
            <Text style={styles.noteText}>
              {t(
                "restaurant.language.supportedNote",
                "Only the 6 supported languages are shown here.",
              )}
            </Text>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MMD_BLUE },
  headerLogo: {
    width: 40,
    height: 40,
    borderRadius: 12,
  },
  body: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 16,
  },
  hint: {
    color: "rgba(255,255,255,0.7)",
    fontFamily: MMD_FONT.regular,
    fontSize: 14,
  },
  search: {
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 14,
    color: MMD_WHITE,
    fontFamily: MMD_FONT.regular,
    fontSize: 14,
  },
  list: {
    gap: 16,
    paddingBottom: 12,
  },
  option: {
    minHeight: 88,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    overflow: "hidden",
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  optionActive: {
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  selectionBar: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: SELECT_GREEN,
    opacity: 0.9,
  },
  flagPill: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  flag: { fontSize: 22 },
  labels: { flex: 1, minWidth: 0, gap: 2 },
  label: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 16,
  },
  native: {
    color: "rgba(255,255,255,0.6)",
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  radioSelected: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: SELECT_GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
  note: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: MMD_GLASS,
  },
  noteText: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.regular,
    fontSize: 12,
    lineHeight: 18,
  },
});

export default RestaurantLanguageScreen;
