import React, { type ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { APP_COLORS, APP_RADIUS, APP_SPACE } from "../../theme/appTheme";

export default function UiCard({
  children,
  style,
  elevated = false,
}: {
  children: ReactNode;
  style?: ViewStyle;
  elevated?: boolean;
}) {
  return (
    <View
      style={[
        styles.card,
        elevated ? styles.elevated : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: APP_COLORS.surface,
    borderRadius: APP_RADIUS.lg,
    borderWidth: 1,
    borderColor: APP_COLORS.border,
    padding: APP_SPACE.lg,
  },
  elevated: {
    backgroundColor: APP_COLORS.bgElevated,
    borderColor: APP_COLORS.borderMuted,
  },
});
