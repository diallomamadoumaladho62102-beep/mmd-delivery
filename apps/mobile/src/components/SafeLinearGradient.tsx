import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

type Props = {
  colors: readonly string[];
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  start?: { x: number; y: number };
  end?: { x: number; y: number };
};

/**
 * CTA fill that does not depend on ExpoLinearGradient native views.
 *
 * Root cause of Login "Unimplemented component: ViewManagerAdapter":
 * expo-linear-gradient's Fabric view manager is missing from some iOS
 * binaries (OTA JS vs native mismatch). A RN View cannot produce that error.
 */
export function SafeLinearGradient({ colors, style, children }: Props) {
  const backgroundColor =
    colors[Math.floor(colors.length / 2)] ?? colors[0] ?? "#3B82F6";
  return <View style={[style, { backgroundColor }]}>{children}</View>;
}
