// apps/mobile/src/screens/RestaurantLanguageScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  Alert,
  TextInput,
  ScrollView,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { setLocaleForRoleAndApply } from "../i18n";

const ROLE = "restaurant" as const;

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
          e?.message ?? "Unable to change language."
        );
      } finally {
        savingRef.current = false;
      }
    },
    [locale, navigation, t]
  );

  const Option = ({ item }: { item: LangOption }) => {
    const active = locale === item.code;

    const onPress = useCallback(() => {
      void save(item.code);
    }, [item.code]);

    return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.9}
        style={{
          paddingVertical: 14,
          paddingHorizontal: 14,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: active ? "#60A5FA" : "#0F172A",
          backgroundColor: active ? "#0A1B3D" : "#071226",
          marginBottom: 10,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              backgroundColor: active ? "#0B2A5C" : "#0A1730",
              borderWidth: 1,
              borderColor: active ? "#3B82F6" : "#0F172A",
              alignItems: "center",
              justifyContent: "center",
              marginRight: 12,
            }}
          >
            <Text style={{ fontSize: 20 }}>{item.flag}</Text>
          </View>

          <View style={{ flex: 1 }}>
            <Text style={{ color: "white", fontWeight: "900", fontSize: 15 }}>
              {item.nativeLabel}
            </Text>

            <Text
              style={{
                color: "#94A3B8",
                fontWeight: "800",
                marginTop: 3,
                fontSize: 12,
              }}
            >
              {item.label} • {item.code.toUpperCase()}
              {item.note ? ` • ${item.note}` : ""}
            </Text>
          </View>
        </View>

        <View
          style={{
            minWidth: 34,
            alignItems: "flex-end",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: active ? "#22C55E" : "#334155",
              fontWeight: "900",
              fontSize: 18,
            }}
          >
            {active ? "✓" : "›"}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <View style={{ padding: 16, flex: 1 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.85}>
            <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
              {t("common.back", "Back")}
            </Text>
          </TouchableOpacity>

          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 999,
              backgroundColor: "#071226",
              borderWidth: 1,
              borderColor: "#0F172A",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>{current.flag}</Text>
            <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
              {current.code.toUpperCase()}
            </Text>
          </View>
        </View>

        <Text style={{ color: "white", fontSize: 22, fontWeight: "900", marginTop: 14 }}>
          {t("common.language", "Language")}
        </Text>

        <Text style={{ color: "#94A3B8", fontWeight: "800", marginTop: 6 }}>
          {t("common.language", "Language")}: {current.nativeLabel} ({current.code})
        </Text>

        <View
          style={{
            marginTop: 14,
            backgroundColor: "#0B1220",
            borderColor: "#0F172A",
            borderWidth: 1,
            borderRadius: 22,
            padding: 14,
            flex: 1,
          }}
        >
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search (English, Français, Español, العربية, 中文, Fulfulde...)"
            placeholderTextColor="#64748B"
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              backgroundColor: "#071226",
              borderColor: "#0F172A",
              borderWidth: 1,
              borderRadius: 16,
              paddingHorizontal: 12,
              paddingVertical: 12,
              color: "white",
              fontWeight: "800",
              marginBottom: 12,
            }}
          />

          <ScrollView showsVerticalScrollIndicator={false}>
            {filtered.map((item) => (
              <Option key={item.code} item={item} />
            ))}

            <View
              style={{
                marginTop: 6,
                padding: 12,
                borderRadius: 16,
                backgroundColor: "#071226",
                borderWidth: 1,
                borderColor: "#0F172A",
              }}
            >
              <Text style={{ color: "#94A3B8", fontWeight: "800", lineHeight: 18 }}>
                ✅ Only the 6 supported languages are shown here.
              </Text>
            </View>
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}