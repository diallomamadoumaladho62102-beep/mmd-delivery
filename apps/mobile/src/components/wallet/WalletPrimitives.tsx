import React from "react";
import {
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  StyleSheet,
  type ViewStyle,
} from "react-native";
import { APP_COLORS } from "../../theme/appTheme";

export function WalletLoadingState({ label }: { label?: string }) {
  return (
    <View style={styles.centered} accessibilityRole="progressbar">
      <ActivityIndicator color={APP_COLORS.accent} />
      {label ? <Text style={styles.muted}>{label}</Text> : null}
    </View>
  );
}

export function WalletErrorState({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <View style={styles.errorBox} accessibilityRole="alert">
      <Text style={styles.errorText}>{message}</Text>
      <TouchableOpacity
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={retryLabel}
        style={styles.retryHit}
      >
        <Text style={styles.retry}>{retryLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

export function WalletEmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.emptyBox}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {actionLabel && onAction ? (
        <TouchableOpacity
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={styles.retryHit}
        >
          <Text style={styles.link}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function WalletSummaryCard({
  label,
  amount,
  footnote,
  children,
  style,
}: {
  label: string;
  amount: string;
  footnote?: string | null;
  children?: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.card, style]}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={styles.balance} accessibilityRole="text">
        {amount}
      </Text>
      {footnote ? <Text style={styles.footnote}>{footnote}</Text> : null}
      {children}
    </View>
  );
}

export function WalletHistoryRow({
  title,
  meta,
  amount,
  amountColor,
  detail,
}: {
  title: string;
  meta: string;
  amount: string;
  amountColor: string;
  detail?: string | null;
}) {
  return (
    <View style={styles.txRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.txTitle}>{title}</Text>
        <Text style={styles.txMeta}>{meta}</Text>
        {detail ? <Text style={styles.txMeta}>{detail}</Text> : null}
      </View>
      <Text style={[styles.txAmount, { color: amountColor }]}>{amount}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 24,
  },
  card: {
    backgroundColor: "rgba(15,23,42,0.86)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.14)",
    padding: 16,
    marginBottom: 14,
  },
  muted: { color: "#94A3B8", fontWeight: "700", fontSize: 12 },
  balance: { color: "#F8FAFC", fontSize: 32, fontWeight: "900", marginTop: 6 },
  footnote: { color: "#64748B", marginTop: 10, fontSize: 12, lineHeight: 18 },
  errorBox: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: "rgba(239,68,68,0.12)",
    marginBottom: 12,
  },
  errorText: { color: "#FCA5A5", fontWeight: "700" },
  retryHit: { marginTop: 10 },
  retry: { color: "#F59E0B", fontWeight: "800" },
  emptyBox: {
    padding: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.16)",
    marginBottom: 12,
  },
  emptyTitle: { color: "#F8FAFC", fontWeight: "900", marginBottom: 6 },
  emptyBody: { color: "#94A3B8", lineHeight: 20 },
  link: { color: "#93C5FD", fontWeight: "800" },
  txRow: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(148,163,184,0.12)",
  },
  txTitle: { color: "#F8FAFC", fontWeight: "800" },
  txMeta: { color: "#94A3B8", fontSize: 12, marginTop: 3 },
  txAmount: { fontWeight: "900" },
});
