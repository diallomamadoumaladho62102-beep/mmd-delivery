import React, { type ReactNode } from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import { useSafeBackNavigation } from "../../navigation/navigationBack";
import { APP_COLORS, APP_HIT } from "../../theme/appTheme";

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
  backAccessibilityLabel?: string;
};

const VARIANTS = {
  dark: {
    title: APP_COLORS.text,
    subtitle: APP_COLORS.textMuted,
    backBorder: "rgba(148,163,184,0.18)",
    backBg: "rgba(15,23,42,0.72)",
    backText: APP_COLORS.text,
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
  backAccessibilityLabel,
}: ScreenHeaderProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const safeBack = useSafeBackNavigation(fallbackRoute);
  const palette = VARIANTS[variant];
  const handleBack = onBack ?? safeBack;
  const backLabel = backAccessibilityLabel ?? t("common.back", "Back");

  return (
    <View style={[styles.wrapper, { paddingTop: Math.max(insets.top, 8) }, style]}>
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
            accessibilityLabel={backLabel}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.backIcon, { color: palette.backText }]}>‹</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.sideSpacer} accessibilityElementsHidden />
        )}

        <View style={styles.titleBlock} accessibilityRole="header">
          <Text style={[styles.title, { color: palette.title }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: palette.subtitle }]} numberOfLines={2}>
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
    minHeight: APP_HIT.comfortable,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    width: APP_HIT.min,
    height: APP_HIT.min,
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
    minWidth: APP_HIT.min,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  sideSpacer: {
    width: APP_HIT.min,
    height: APP_HIT.min,
  },
});
