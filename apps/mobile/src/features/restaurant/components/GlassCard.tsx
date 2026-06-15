import React, { memo, type ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { CC, glassCardStyle } from "./commandCenterTheme";

type Props = {
  children: ReactNode;
  variant?: "default" | "hero" | "gold";
  style?: ViewStyle;
  accentBar?: string;
};

function GlassCardComponent({ children, variant = "default", style, accentBar }: Props) {
  return (
    <View style={[glassCardStyle(variant), styles.wrap, style]}>
      {accentBar ? <View style={[styles.accentBar, { backgroundColor: accentBar }]} /> : null}
      {children}
    </View>
  );
}

export const GlassCard = memo(GlassCardComponent);

const styles = StyleSheet.create({
  wrap: {
    padding: 16,
  },
  accentBar: {
    position: "absolute",
    top: 0,
    left: 16,
    right: 16,
    height: 3,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    opacity: 0.9,
  },
});
