import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReduceMotion } from "../../hooks/useReduceMotion";

type Props = {
  liveTitle: string;
  liveSubtitle: string;
  etaLabel: string | null;
  onBack: () => void;
  backAccessibilityLabel?: string;
  /** Only show chevron when a real action exists. */
  onEtaPress?: (() => void) | null;
};

/**
 * Floating Live tracking + ETA pills over the map (safe-area aware).
 * Translucent dark surfaces — no native Blur dependency (avoids rebuild).
 */
export const TrackingTopBar = React.memo(function TrackingTopBar({
  liveTitle,
  liveSubtitle,
  etaLabel,
  onBack,
  backAccessibilityLabel = "Go back",
  onEtaPress = null,
}: Props) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { paddingTop: Math.max(insets.top, 8) + 6 }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={backAccessibilityLabel}
        onPress={onBack}
        hitSlop={10}
        style={styles.backBtn}
      >
        <Ionicons name="chevron-back" size={22} color="#F8FAFC" />
      </Pressable>

      <View style={styles.livePill} accessibilityRole="summary">
        <Animated.View style={[styles.liveDot, { opacity: pulse }]} />
        <View style={styles.liveTextCol}>
          <Text style={styles.liveTitle} numberOfLines={1}>
            {liveTitle}
          </Text>
          <Text style={styles.liveSubtitle} numberOfLines={1}>
            {liveSubtitle}
          </Text>
        </View>
      </View>

      <Pressable
        accessibilityRole={onEtaPress ? "button" : "text"}
        accessibilityLabel={etaLabel ? `ETA ${etaLabel}` : "ETA unavailable"}
        disabled={!onEtaPress}
        onPress={onEtaPress ?? undefined}
        style={styles.etaPill}
      >
        <Ionicons name="time-outline" size={16} color="#A5B4FC" />
        <Text style={styles.etaText} numberOfLines={1}>
          {etaLabel ?? "—"}
        </Text>
        {onEtaPress ? (
          <Ionicons name="chevron-down" size={14} color="#94A3B8" />
        ) : null}
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(11,18,32,0.88)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.22)",
  },
  livePill: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "rgba(11,18,32,0.9)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.2)",
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#22C55E",
  },
  liveTextCol: {
    flex: 1,
    minWidth: 0,
  },
  liveTitle: {
    color: "#F8FAFC",
    fontSize: 13,
    fontWeight: "800",
  },
  liveSubtitle: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 1,
  },
  etaPill: {
    maxWidth: 128,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "rgba(11,18,32,0.9)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.2)",
  },
  etaText: {
    color: "#E2E8F0",
    fontSize: 12,
    fontWeight: "800",
    flexShrink: 1,
  },
});
