import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useReduceMotion } from "../../hooks/useReduceMotion";

type Props = {
  statusLine: string;
  etaLabel: string | null;
  safetyLine: string;
};

export const TrackingStatusBanner = React.memo(function TrackingStatusBanner({
  statusLine,
  etaLabel,
  safetyLine,
}: Props) {
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 1100,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  return (
    <View style={styles.card} accessibilityRole="summary">
      <View style={styles.cell}>
        <Animated.View style={{ opacity: pulse }}>
          <Ionicons name="radio-outline" size={16} color="#4ADE80" />
        </Animated.View>
        <Text style={styles.primary} numberOfLines={2}>
          {statusLine}
        </Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.cell}>
        <Ionicons name="time-outline" size={16} color="#A78BFA" />
        <Text style={styles.primary} numberOfLines={2}>
          {etaLabel ?? "—"}
        </Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.cell}>
        <Ionicons name="shield-checkmark-outline" size={16} color="#E2E8F0" />
        <Text style={styles.secondary} numberOfLines={2}>
          {safetyLine}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: "#0F172A",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.16)",
    paddingVertical: 12,
    paddingHorizontal: 8,
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  cell: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 4,
  },
  divider: {
    width: 1,
    backgroundColor: "rgba(148,163,184,0.18)",
    marginVertical: 2,
  },
  primary: {
    color: "#F8FAFC",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 14,
  },
  secondary: {
    color: "#CBD5E1",
    fontSize: 10,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 13,
  },
});
