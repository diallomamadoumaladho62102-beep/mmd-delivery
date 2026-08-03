import React from "react";
import { StyleSheet, Text, View } from "react-native";

type Props = {
  title: string;
  code: string | null | undefined;
  subtitle: string;
  pendingLabel?: string;
};

/** Premium OTP / PIN display for client pickup & delivery verification. */
export function VerificationCodeCard({
  title,
  code,
  subtitle,
  pendingLabel = "Code will appear shortly",
}: Props) {
  const digits = String(code ?? "")
    .replace(/\s/g, "")
    .trim();
  const ready = digits.length >= 4;

  return (
    <View style={styles.card}>
      <Text style={styles.lock}>🔐</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.code} accessibilityRole="text">
        {ready ? digits : "····"}
      </Text>
      <Text style={styles.subtitle}>
        {ready ? subtitle : pendingLabel}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    paddingVertical: 22,
    paddingHorizontal: 18,
    marginBottom: 14,
    backgroundColor: "rgba(15,23,42,0.96)",
    borderWidth: 1,
    borderColor: "rgba(245,197,66,0.45)",
    alignItems: "center",
    shadowColor: "#F59E0B",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  lock: {
    fontSize: 22,
    marginBottom: 8,
  },
  title: {
    color: "#FDE68A",
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: 0.2,
    marginBottom: 12,
  },
  code: {
    color: "#FFFFFF",
    fontSize: 44,
    fontWeight: "900",
    letterSpacing: 10,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
    marginBottom: 12,
  },
  subtitle: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
    lineHeight: 19,
    paddingHorizontal: 8,
  },
});
