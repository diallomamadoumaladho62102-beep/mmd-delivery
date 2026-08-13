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
  onSignOut?: () => void;
};

export function ClientHomeLanguageSheet({
  visible,
  ts,
  currentLang,
  onClose,
  onSelect,
  onSignOut,
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

          <LanguagePicker
            currentCode={currentLang}
            onSelect={handleSelect}
            hideTitle
            variant="mmdHome"
          />

          {onSignOut ? (
            <Pressable
              onPress={() => {
                onClose();
                onSignOut();
              }}
              style={styles.signOutButton}
              accessibilityRole="button"
              accessibilityLabel={ts("client.profile.signOut.button", "Sign Out")}
              testID="client-home-sign-out"
              hitSlop={10}
            >
              <Text style={styles.signOutText}>
                {ts("client.profile.signOut.button", "Sign Out")}
              </Text>
            </Pressable>
          ) : null}

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
    borderTopLeftRadius: V4_RADIUS.xl,
    borderTopRightRadius: V4_RADIUS.xl,
    backgroundColor: V4.navBg,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingHorizontal: 18,
    paddingTop: 12,
    maxHeight: "82%",
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: V4.gold,
    alignSelf: "center",
    marginBottom: 16,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: V4.gold,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  heroIconGlyph: { fontSize: 24, color: V4.navBg },
  title: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800",
    fontFamily: V4.font.extrabold,
  },
  subtitle: {
    color: "#CCCCD9",
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
  dismissText: { color: V4.gold, fontSize: 15, fontWeight: "700" },
  signOutButton: {
    marginTop: 10,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
    backgroundColor: "#0D2666",
  },
  signOutText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
});
