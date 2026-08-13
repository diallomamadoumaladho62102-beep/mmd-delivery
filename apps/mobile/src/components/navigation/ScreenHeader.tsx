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
import {
  MMD_FONT,
  MMD_GOLD_BRIGHT,
  MMD_TEXT_SOFT_BLUE,
  MMD_WHITE,
} from "../../theme/mmdUi";

export type ScreenHeaderVariant = "dark" | "light" | "brand" | "mmd";

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
    backLabel: "‹" as const,
    titleSize: 18,
    subtitleSize: 13,
    backBoxed: true,
    backSize: APP_HIT.min,
    backRadius: 22,
    titleFamily: undefined as string | undefined,
    subtitleFamily: undefined as string | undefined,
  },
  light: {
    title: "#0F172A",
    subtitle: "#64748B",
    backBorder: "#E2E8F0",
    backBg: "#FFFFFF",
    backText: "#0F172A",
    backLabel: "‹" as const,
    titleSize: 18,
    subtitleSize: 13,
    backBoxed: true,
    backSize: APP_HIT.min,
    backRadius: 22,
    titleFamily: undefined as string | undefined,
    subtitleFamily: undefined as string | undefined,
  },
  /** Figma Customer App Lot 3 — gold BACK + white title on MMD_BLUE */
  brand: {
    title: MMD_WHITE,
    subtitle: MMD_GOLD_BRIGHT,
    backBorder: "transparent",
    backBg: "transparent",
    backText: MMD_GOLD_BRIGHT,
    backLabel: "BACK" as const,
    titleSize: 20,
    subtitleSize: 12,
    backBoxed: false,
    backSize: APP_HIT.min,
    backRadius: 22,
    titleFamily: MMD_FONT.bold,
    subtitleFamily: MMD_FONT.regular,
  },
  /** Figma Driver App — Lot 3 headers on MMD_BLUE */
  mmd: {
    title: MMD_WHITE,
    subtitle: MMD_TEXT_SOFT_BLUE,
    backBorder: "rgba(170,190,230,0.18)",
    backBg: "rgba(0,51,153,0.72)",
    backText: MMD_WHITE,
    backLabel: "‹" as const,
    titleSize: 17,
    subtitleSize: 12,
    backBoxed: true,
    backSize: 44,
    backRadius: 12,
    titleFamily: MMD_FONT.bold,
    subtitleFamily: MMD_FONT.regular,
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
              palette.backBoxed ? styles.backButton : styles.backTextButton,
              palette.backBoxed
                ? {
                    borderColor: palette.backBorder,
                    backgroundColor: palette.backBg,
                    width: palette.backSize,
                    height: palette.backSize,
                    borderRadius: palette.backRadius,
                  }
                : null,
            ]}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={backLabel}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text
              style={[
                palette.backBoxed ? styles.backIcon : styles.backTextLabel,
                {
                  color: palette.backText,
                  fontFamily: variant === "mmd" ? MMD_FONT.bold : undefined,
                  fontSize: variant === "mmd" ? 22 : undefined,
                },
              ]}
            >
              {palette.backLabel}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.sideSpacer} accessibilityElementsHidden />
        )}

        <View style={styles.titleBlock} accessibilityRole="header">
          <Text
            style={[
              styles.title,
              {
                color: palette.title,
                fontSize: palette.titleSize,
                fontFamily: palette.titleFamily,
              },
            ]}
            numberOfLines={2}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[
                styles.subtitle,
                {
                  color: palette.subtitle,
                  fontSize: palette.subtitleSize,
                  fontFamily: palette.subtitleFamily,
                  marginTop: variant === "mmd" ? 2 : undefined,
                },
              ]}
              numberOfLines={3}
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
    minHeight: APP_HIT.comfortable,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    width: APP_HIT.min,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  backTextButton: {
    minHeight: APP_HIT.min,
    minWidth: APP_HIT.min,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: {
    fontSize: 28,
    lineHeight: 30,
    fontWeight: "600",
    marginTop: -2,
  },
  backTextLabel: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: MMD_FONT.semibold,
    letterSpacing: 0.2,
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
