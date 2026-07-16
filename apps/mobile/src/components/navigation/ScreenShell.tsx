import React, { type ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { APP_COLORS } from "../../theme/appTheme";
import ScreenHeader, { type ScreenHeaderProps } from "./ScreenHeader";

type ScreenShellProps = ScreenHeaderProps & {
  children: ReactNode;
  backgroundColor?: string;
  edges?: Array<"top" | "bottom" | "left" | "right">;
  contentStyle?: ViewStyle;
  headerShown?: boolean;
};

export default function ScreenShell({
  children,
  backgroundColor = APP_COLORS.bg,
  edges = ["bottom", "left", "right"],
  contentStyle,
  headerShown = true,
  ...headerProps
}: ScreenShellProps) {
  return (
    <SafeAreaView edges={edges} style={[styles.safe, { backgroundColor }]}>
      {headerShown ? <ScreenHeader {...headerProps} /> : null}
      <View style={[styles.content, contentStyle]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});
