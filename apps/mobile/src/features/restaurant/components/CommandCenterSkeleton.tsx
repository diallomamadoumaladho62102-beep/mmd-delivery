import React, { memo, useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { CC } from "./commandCenterTheme";

function ShimmerBlock({
  width,
  height,
  style,
}: {
  width: number | `${number}%`;
  height: number;
  style?: object;
}) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  const opacity = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0.75],
  });

  return <Animated.View style={[styles.block, { width, height, opacity }, style]} />;
}

function CommandCenterSkeletonComponent() {
  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <ShimmerBlock width={40} height={40} style={styles.round} />
        <View style={styles.headerCopy}>
          <ShimmerBlock width="70%" height={22} />
          <ShimmerBlock width="45%" height={12} style={styles.mt6} />
        </View>
        <ShimmerBlock width={72} height={32} style={styles.pill} />
      </View>

      <ShimmerBlock width="85%" height={14} />

      <ShimmerBlock width="100%" height={320} style={styles.hero} />

      <View style={styles.kpiRow}>
        <ShimmerBlock width={172} height={120} style={styles.card} />
        <ShimmerBlock width={172} height={120} style={styles.card} />
        <ShimmerBlock width={172} height={120} style={styles.card} />
      </View>

      <ShimmerBlock width="100%" height={220} style={styles.hero} />
      <ShimmerBlock width="100%" height={360} style={styles.card} />
      <ShimmerBlock width="100%" height={200} style={styles.card} />
      <ShimmerBlock width="100%" height={160} style={styles.card} />
    </View>
  );
}

export const CommandCenterSkeleton = memo(CommandCenterSkeletonComponent);

const styles = StyleSheet.create({
  wrap: {
    padding: 16,
    gap: 16,
    backgroundColor: CC.bg,
    flex: 1,
  },
  block: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.08)",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerCopy: {
    flex: 1,
  },
  hero: {
    borderRadius: 24,
  },
  card: {
    borderRadius: 20,
  },
  round: {
    borderRadius: 14,
  },
  pill: {
    borderRadius: 999,
  },
  kpiRow: {
    flexDirection: "row",
    gap: 12,
  },
  mt6: {
    marginTop: 6,
  },
});
