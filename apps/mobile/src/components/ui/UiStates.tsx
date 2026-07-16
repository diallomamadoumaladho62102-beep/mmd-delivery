import React from "react";
import { ActivityIndicator, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { APP_COLORS, APP_SPACE, APP_TYPO } from "../../theme/appTheme";
import UiButton from "./UiButton";

type CommonProps = {
  title: string;
  message?: string;
  style?: ViewStyle;
};

export function UiLoadingState({
  label = "Loading…",
  style,
}: {
  label?: string;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.wrap, style]} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={APP_COLORS.accent} />
      <Text style={styles.message}>{label}</Text>
    </View>
  );
}

export function UiEmptyState({
  title,
  message,
  actionLabel,
  onAction,
  style,
}: CommonProps & { actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={[styles.wrap, style]} accessibilityRole="summary">
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <UiButton
          label={actionLabel}
          onPress={onAction}
          variant="secondary"
          style={{ marginTop: APP_SPACE.md, alignSelf: "center", minWidth: 160 }}
        />
      ) : null}
    </View>
  );
}

export function UiErrorState({
  title,
  message,
  actionLabel = "Retry",
  onAction,
  style,
}: CommonProps & { actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={[styles.wrap, style]} accessibilityRole="alert">
      <Text style={[styles.title, { color: APP_COLORS.danger }]}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {onAction ? (
        <UiButton
          label={actionLabel}
          onPress={onAction}
          variant="secondary"
          style={{ marginTop: APP_SPACE.md, alignSelf: "center", minWidth: 160 }}
        />
      ) : null}
    </View>
  );
}

/** Lightweight skeleton block for list placeholders. */
export function UiSkeleton({
  height = 72,
  style,
}: {
  height?: number;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        styles.skeleton,
        { height },
        style,
      ]}
      accessibilityLabel="Loading placeholder"
    />
  );
}

const styles = StyleSheet.create({
  wrap: {
    padding: APP_SPACE.xl,
    alignItems: "center",
    justifyContent: "center",
    gap: APP_SPACE.sm,
  },
  title: {
    ...APP_TYPO.title,
    color: APP_COLORS.text,
    textAlign: "center",
  },
  message: {
    ...APP_TYPO.body,
    color: APP_COLORS.textMuted,
    textAlign: "center",
  },
  skeleton: {
    borderRadius: 14,
    backgroundColor: "rgba(148,163,184,0.18)",
    borderWidth: 1,
    borderColor: APP_COLORS.border,
  },
});
