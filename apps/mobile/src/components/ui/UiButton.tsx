import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { APP_COLORS, APP_HIT, APP_RADIUS, APP_TYPO } from "../../theme/appTheme";

type UiButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export type UiButtonProps = Omit<PressableProps, "style"> & {
  label: string;
  variant?: UiButtonVariant;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
};

const VARIANT_STYLES: Record<
  UiButtonVariant,
  { bg: string; border: string; text: string }
> = {
  primary: {
    bg: APP_COLORS.accentStrong,
    border: APP_COLORS.accentStrong,
    text: APP_COLORS.onAccent,
  },
  secondary: {
    bg: APP_COLORS.surface,
    border: APP_COLORS.borderMuted,
    text: APP_COLORS.text,
  },
  danger: {
    bg: APP_COLORS.dangerStrong,
    border: APP_COLORS.dangerStrong,
    text: APP_COLORS.onAccent,
  },
  ghost: {
    bg: "transparent",
    border: "transparent",
    text: APP_COLORS.accent,
  },
};

export default function UiButton({
  label,
  variant = "primary",
  loading = false,
  disabled,
  style,
  labelStyle,
  accessibilityLabel,
  ...rest
}: UiButtonProps) {
  const palette = VARIANT_STYLES[variant];
  const isDisabled = Boolean(disabled || loading);

  return (
    <Pressable
      {...rest}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          opacity: isDisabled ? 0.55 : pressed ? 0.88 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.text} />
      ) : (
        <Text style={[styles.label, { color: palette.text }, labelStyle]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: APP_HIT.comfortable,
    borderRadius: APP_RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    ...APP_TYPO.button,
  },
});
