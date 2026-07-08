import React, { type ReactNode } from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import { useSafeBackNavigation } from "../../navigation/navigationBack";

export type ScreenHeaderVariant = "dark" | "light";

export type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  fallbackRoute?: keyof RootStackParamList;
  onBack?: () => void;
  showBack?: boolean;
  rightSlot?: ReactNode;
  variant?: ScreenHeaderVariant;
  style?: ViewStyle;
};

const VARIANTS = {
  dark: {
    title: "#F8FAFC",
    subtitle: "#94A3B8",
    backBorder: "rgba(148,163,184,0.18)",
    backBg: "rgba(15,23,42,0.72)",
    backText: "#F8FAFC",
  },
  light: {
    title: "#0F172A",
    subtitle: "#64748B",
    backBorder: "#E2E8F0",
    backBg: "#FFFFFF",
    backText: "#0F172A",
  },
} as const;

export default function ScreenHeader({
  title,
  subtitle,
  fallbackRoute,
  onBack,
  showBack = true,
  rightSlot,
  variant = "dark",
  style,
}: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const safeBack = useSafeBackNavigation(fallbackRoute);
  const palette = VARIANTS[variant];
  const handleBack = onBack ?? safeBack;

  return (
    <View
      style={[
        styles.wrapper,
        { paddingTop: Math.max(insets.top, 8) },
        style,
      ]}
    >
      <View style={styles.row}>
        {showBack ? (
          <TouchableOpacity
            onPress={handleBack}
            style={[
              styles.backButton,
              {
                borderColor: palette.backBorder,
                backgroundColor: palette.backBg,
              },
            ]}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Retour"
          >
            <Text style={[styles.backIcon, { color: palette.backText }]}>‹</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.sideSpacer} />
        )}

        <View style={styles.titleBlock}>
          <Text
            style={[styles.title, { color: palette.title }]}
            numberOfLines={1}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[styles.subtitle, { color: palette.subtitle }]}
              numberOfLines={2}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>

        {rightSlot ? (
          <View style={styles.rightSlot}>{rightSlot}</View>
        ) : (
          <View style={styles.sideSpacer} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: {
    fontSize: 28,
    lineHeight: 30,
    fontWeight: "600",
    marginTop: -2,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
  },
  rightSlot: {
    minWidth: 44,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  sideSpacer: {
    width: 44,
    height: 44,
  },
});
