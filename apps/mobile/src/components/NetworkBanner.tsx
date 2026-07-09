import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useNetworkStatus } from "../hooks/useNetworkStatus";

export function NetworkBanner(): React.JSX.Element | null {
  const { quality } = useNetworkStatus();

  if (quality === "online") return null;

  const label =
    quality === "offline"
      ? "No network connection"
      : "Weak network connection";

  return (
    <View
      style={[
        styles.banner,
        quality === "offline" ? styles.offline : styles.weak,
      ]}
      accessibilityRole="alert"
    >
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  offline: {
    backgroundColor: "#7F1D1D",
  },
  weak: {
    backgroundColor: "#92400E",
  },
  text: {
    color: "#FFF7ED",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
});
