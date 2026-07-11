import React, { useRef } from "react";
import { Animated, Pressable, Text, View, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  NAV_ELEVATION,
  NAV_HIT,
  NAV_MOTION,
  NAV_RADIUS,
  navPalette,
  type NavColorScheme,
} from "../../../theme/navigationTheme";
import { useReduceMotion } from "../../../hooks/useReduceMotion";

export type MapFloatingButtonState = "default" | "active" | "alert" | "disabled";

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
  scheme?: NavColorScheme;
  state?: MapFloatingButtonState;
  compact?: boolean;
  /** Optional tiny caption under the icon (e.g. "Nord"). */
  caption?: string;
  style?: ViewStyle;
};

/**
 * Premium floating map control — a single coherent family used for recenter,
 * heading lock, voice, report, events, options, close and safety toggles.
 * Rounded, layered elevation, high-contrast, animated press, clear active /
 * alert / disabled states, and an accessible tactile target.
 */
export function MapFloatingButton({
  icon,
  onPress,
  accessibilityLabel,
  scheme = "night",
  state = "default",
  compact = false,
  caption,
  style,
}: Props) {
  const palette = navPalette(scheme);
  const reduceMotion = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const disabled = state === "disabled";

  const size = compact ? NAV_HIT.buttonCompact : NAV_HIT.button;

  const background =
    state === "active"
      ? palette.active
      : state === "alert"
        ? palette.danger
        : palette.surface;
  const foreground =
    state === "active"
      ? palette.activeOn
      : state === "alert"
        ? "#FFFFFF"
        : disabled
          ? palette.onSurfaceMuted
          : palette.onSurface;
  const borderColor =
    state === "active"
      ? palette.active
      : state === "alert"
        ? palette.danger
        : palette.surfaceBorder;

  const animateTo = (value: number) => {
    if (reduceMotion) return;
    Animated.timing(scale, {
      toValue: value,
      duration: NAV_MOTION.fast,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={[{ alignItems: "center", transform: [{ scale }] }, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled, selected: state === "active" }}
        disabled={disabled}
        onPressIn={() => animateTo(NAV_MOTION.pressScale)}
        onPressOut={() => animateTo(1)}
        onPress={onPress}
        hitSlop={8}
        style={{
          width: size,
          height: size,
          borderRadius: NAV_RADIUS.lg,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: background,
          borderWidth: 1,
          borderColor,
          opacity: disabled ? 0.55 : 1,
          ...NAV_ELEVATION.medium,
        }}
      >
        <Ionicons
          name={icon}
          size={compact ? NAV_HIT.iconSm : NAV_HIT.iconMd}
          color={foreground}
        />
      </Pressable>
      {caption ? (
        <View
          style={{
            marginTop: 3,
            paddingHorizontal: 6,
            paddingVertical: 1,
            borderRadius: NAV_RADIUS.pill,
            backgroundColor: palette.surface,
          }}
        >
          <Text
            style={{
              color: palette.onSurfaceMuted,
              fontSize: 9,
              fontWeight: "800",
              letterSpacing: 0.2,
            }}
          >
            {caption}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
}
