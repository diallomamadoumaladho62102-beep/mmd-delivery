import React from "react";
import { Modal, View, Text, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import LanguagePicker from "../../LanguagePicker";
import type { AppLanguageCode } from "../../../i18n/languageOptions";
import { V4, V4_RADIUS } from "./clientHomeTheme";

type TsFn = (key: string, fallback: string, params?: Record<string, unknown>) => string;

type Props = {
  visible: boolean;
  ts: TsFn;
  currentLang: string;
  onClose: () => void;
  onSelect: (lang: AppLanguageCode) => void;
};

export function ClientHomeLanguageSheet({
  visible,
  ts,
  currentLang,
  onClose,
  onSelect,
}: Props) {
  const insets = useSafeAreaInsets();

  const handleSelect = (lang: AppLanguageCode) => {
    onSelect(lang);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID="client-home-language-sheet"
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close language sheet">
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.handle} />

          <View style={styles.heroIcon}>
            <Text style={styles.heroIconGlyph}>🌐</Text>
          </View>

          <Text style={styles.title}>{ts("language.pickerTitle", "Language")}</Text>
          <Text style={styles.subtitle}>
            {ts("client.home.v4.language.subtitle", "Choose your preferred language for MMD.")}
          </Text>

          <LanguagePicker currentCode={currentLang} onSelect={handleSelect} />

          <Pressable
            onPress={onClose}
            style={styles.dismissButton}
            accessibilityRole="button"
            accessibilityLabel={ts("common.close", "Close")}
            testID="client-home-language-close"
            hitSlop={10}
          >
            <Text style={styles.dismissText}>{ts("common.close", "Close")}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(2,6,23,0.78)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: V4_RADIUS.lg,
    borderTopRightRadius: V4_RADIUS.lg,
    backgroundColor: V4.card,
    borderWidth: 1,
    borderColor: V4.border,
    paddingHorizontal: 18,
    paddingTop: 12,
    maxHeight: "82%",
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#D1D5DB",
    alignSelf: "center",
    marginBottom: 16,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#DBEAFE",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  heroIconGlyph: { fontSize: 24 },
  title: { color: V4.textPrimary, fontSize: 22, fontWeight: "900" },
  subtitle: {
    color: V4.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 16,
    fontWeight: "600",
  },
  dismissButton: {
    marginTop: 14,
    alignItems: "center",
    paddingVertical: 12,
  },
  dismissText: { color: V4.green, fontSize: 15, fontWeight: "700" },
});
