import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

/**
 * Aurora — official MMD Delivery map presence marker.
 * Exclusive navy + green signature with soft respiration and heading cue.
 * Visual identity only — no business logic.
 */
const C = {
  navy: "#0B1220",
  green: "#16A34A",
  greenSoft: "#4ADE80",
  white: "#FFFFFF",
  mist: "rgba(22, 163, 74, 0.24)",
  mistSoft: "rgba(74, 222, 128, 0.14)",
} as const;

type Props = {
  /** Degrees clockwise from north. Null/invalid = north-facing idle. */
  headingDeg: number | null;
  /** True when GPS reports meaningful movement. */
  moving?: boolean;
  /** Softer presence when driver is offline. */
  online?: boolean;
};

function normalizeHeading(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value) || value < 0) return 0;
  return ((value % 360) + 360) % 360;
}

export function MmdDriverLocationMarker({
  headingDeg,
  moving = false,
  online = true,
}: Props) {
  const breath = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const duration = !online ? 2800 : moving ? 1300 : 2000;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration,
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath, moving, online]);

  const haloScale = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [1, moving && online ? 1.26 : 1.12],
  });
  const haloOpacity = breath.interpolate({
    inputRange: [0, 1],
    outputRange: online
      ? [moving ? 0.58 : 0.4, moving ? 0.14 : 0.1]
      : [0.28, 0.08],
  });
  const corePulse = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [1, online ? 1.045 : 1.02],
  });

  const heading = normalizeHeading(headingDeg);
  const rotateStyle = { transform: [{ rotate: `${heading}deg` }] };

  return (
    <View style={styles.host} pointerEvents="none">
      <Animated.View
        style={[
          styles.haloOuter,
          {
            opacity: haloOpacity,
            transform: [{ scale: haloScale }],
            backgroundColor: online ? C.mist : C.mistSoft,
          },
        ]}
      />
      <Animated.View style={[styles.coreHost, { transform: [{ scale: corePulse }] }, rotateStyle]}>
        <View style={[styles.outerRing, !online && styles.outerRingOffline]} />
        <View style={[styles.innerRing, !online && styles.innerRingOffline]} />
        <View style={[styles.core, !online && styles.coreOffline]}>
          <View style={styles.coreDot} />
        </View>
        {moving && online ? (
          <View style={styles.headingNotch} />
        ) : (
          <View style={[styles.headingPip, !online && styles.headingPipOffline]} />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    width: 88,
    height: 88,
    alignItems: "center",
    justifyContent: "center",
  },
  haloOuter: {
    position: "absolute",
    width: 78,
    height: 78,
    borderRadius: 39,
  },
  coreHost: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  outerRing: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
    borderColor: "rgba(22,163,74,0.62)",
    backgroundColor: "rgba(255,255,255,0.72)",
    shadowColor: C.green,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  outerRingOffline: {
    borderColor: "rgba(100,116,139,0.45)",
    shadowOpacity: 0.12,
    backgroundColor: "rgba(255,255,255,0.82)",
  },
  innerRing: {
    position: "absolute",
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2.5,
    borderColor: C.white,
    backgroundColor: C.navy,
  },
  innerRingOffline: {
    backgroundColor: "#1E293B",
  },
  core: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: C.green,
    alignItems: "center",
    justifyContent: "center",
  },
  coreOffline: {
    backgroundColor: "#64748B",
  },
  coreDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.white,
  },
  headingNotch: {
    position: "absolute",
    top: -3,
    width: 0,
    height: 0,
    borderLeftWidth: 6.5,
    borderRightWidth: 6.5,
    borderBottomWidth: 11,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: C.greenSoft,
  },
  headingPip: {
    position: "absolute",
    top: 1,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: C.greenSoft,
    borderWidth: 1.5,
    borderColor: C.white,
  },
  headingPipOffline: {
    backgroundColor: "#94A3B8",
  },
});
