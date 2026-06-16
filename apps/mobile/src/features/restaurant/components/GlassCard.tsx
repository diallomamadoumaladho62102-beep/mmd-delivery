import React, { memo, type ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { CC, glassCardStyle } from "./commandCenterTheme";

type Props = {
  children: ReactNode;
  variant?: "default" | "hero" | "gold" | "map";
  style?: ViewStyle;
  accentBar?: string;
};

function GlassCardComponent({ children, variant = "default", style, accentBar }: Props) {
  const padding =
    variant === "hero" ? styles.heroWrap : variant === "map" ? styles.mapWrap : styles.wrap;

  return (
    <View style={[glassCardStyle(variant), padding, style]}>
      {accentBar ? <View style={[styles.accentBar, { backgroundColor: accentBar }]} /> : null}
      {variant === "map" ? <View style={styles.mapInnerGlow} pointerEvents="none" /> : null}
      {children}
    </View>
  );
}

export const GlassCard = memo(GlassCardComponent);

const styles = StyleSheet.create({
  wrap: {
    padding: 16,
  },
  heroWrap: {
    padding: 20,
  },
  mapWrap: {
    padding: 14,
  },
  accentBar: {
    position: "absolute",
    top: 0,
    left: 20,
    right: 20,
    height: 4,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    opacity: 0.95,
  },
  mapInnerGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.12)",
  },
});
