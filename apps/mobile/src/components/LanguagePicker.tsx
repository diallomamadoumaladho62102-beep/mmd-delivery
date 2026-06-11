import React, { useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useTranslation } from "react-i18next";
import {
  SUPPORTED_LANGUAGES,
  type AppLanguageCode,
} from "../i18n/languageOptions";
import { rowDirection, textAlignStart } from "../i18n/rtl";

type Props = {
  currentCode?: string;
  onSelect: (code: AppLanguageCode) => void | Promise<void>;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function LanguagePicker({
  currentCode,
  onSelect,
  compact = false,
  style,
}: Props) {
  const { t } = useTranslation();
  const active = (currentCode || "en").split("-")[0] as AppLanguageCode;
  const direction = rowDirection();

  const options = useMemo(() => SUPPORTED_LANGUAGES, []);

  const handlePress = useCallback(
    (code: AppLanguageCode) => {
      if (code === active) return;
      void onSelect(code);
    },
    [active, onSelect]
  );

  if (compact) {
    return (
      <View style={[styles.compactRow, { flexDirection: direction }, style]}>
        {options.map((lang) => {
          const selected = active === lang.code;
          return (
            <TouchableOpacity
              key={lang.code}
              activeOpacity={0.85}
              onPress={() => handlePress(lang.code)}
              style={[styles.compactChip, selected && styles.compactChipActive]}
              accessibilityRole="button"
              accessibilityLabel={lang.nativeLabel}
            >
              <Text style={[styles.compactCode, selected && styles.compactCodeActive]}>
                {lang.code.toUpperCase()}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  }

  return (
    <View style={[styles.list, style]}>
      <Text style={[styles.title, { textAlign: textAlignStart() }]}>
        {t("language.pickerTitle", "Language")}
      </Text>
      {options.map((lang) => {
        const selected = active === lang.code;
        return (
          <TouchableOpacity
            key={lang.code}
            activeOpacity={0.85}
            onPress={() => handlePress(lang.code)}
            style={[styles.row, selected && styles.rowActive, { flexDirection: direction }]}
          >
            <Text style={styles.flag}>{lang.flag}</Text>
            <View style={styles.labels}>
              <Text style={[styles.native, { textAlign: textAlignStart() }]}>
                {lang.nativeLabel}
              </Text>
              <Text style={[styles.sub, { textAlign: textAlignStart() }]}>
                {lang.label} · {lang.code.toUpperCase()}
                {lang.rtl ? " · RTL" : ""}
              </Text>
            </View>
            {selected ? <Text style={styles.check}>✓</Text> : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  compactRow: {
    flexWrap: "wrap",
    gap: 6,
    alignItems: "center",
  },
  compactChip: {
    minWidth: 34,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
  },
  compactChipActive: {
    borderColor: "#60A5FA",
    backgroundColor: "rgba(37,99,235,0.35)",
  },
  compactCode: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  compactCodeActive: {
    color: "#FFFFFF",
  },
  list: {
    gap: 8,
  },
  title: {
    color: "#E5E7EB",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 4,
  },
  row: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  rowActive: {
    borderColor: "#3B82F6",
    backgroundColor: "rgba(59,130,246,0.12)",
  },
  flag: {
    fontSize: 20,
  },
  labels: {
    flex: 1,
    gap: 2,
  },
  native: {
    color: "#F9FAFB",
    fontSize: 15,
    fontWeight: "700",
  },
  sub: {
    color: "#9CA3AF",
    fontSize: 12,
  },
  check: {
    color: "#60A5FA",
    fontSize: 16,
    fontWeight: "800",
  },
});

export default LanguagePicker;
