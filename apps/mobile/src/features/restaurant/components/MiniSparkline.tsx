import React, { memo, useMemo } from "react";
import { StyleSheet, View } from "react-native";

type Props = {
  values: number[];
  color: string;
  width?: number;
  height?: number;
};

function MiniSparklineComponent({ values, color, width = 72, height = 32 }: Props) {
  const points = useMemo(() => {
    const safe = values.filter((v) => Number.isFinite(v));
    if (safe.length === 0) return [];
    const max = Math.max(...safe, 1);
    const min = Math.min(...safe, 0);
    const range = Math.max(max - min, 1);
    const step = safe.length > 1 ? width / (safe.length - 1) : width;

    return safe.map((value, index) => ({
      x: index * step,
      y: height - ((value - min) / range) * (height - 4) + 2,
    }));
  }, [height, values, width]);

  if (points.length < 2) {
    return (
      <View style={[styles.fallback, { width, height, backgroundColor: `${color}22` }]}>
        <View style={[styles.dot, { backgroundColor: color }]} />
      </View>
    );
  }

  return (
    <View style={{ width, height }}>
      {points.slice(1).map((point, index) => {
        const prev = points[index];
        const dx = point.x - prev.x;
        const dy = point.y - prev.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

        return (
          <View
            key={`seg-${index}`}
            style={[
              styles.segment,
              {
                width: length,
                left: prev.x,
                top: prev.y,
                backgroundColor: color,
                transform: [{ rotate: `${angle}deg` }],
              },
            ]}
          />
        );
      })}
      {points.map((point, index) => (
        <View
          key={`pt-${index}`}
          style={[
            styles.dot,
            {
              left: point.x - 3,
              top: point.y - 3,
              backgroundColor: color,
            },
          ]}
        />
      ))}
    </View>
  );
}

export const MiniSparkline = memo(MiniSparklineComponent);

const styles = StyleSheet.create({
  segment: {
    position: "absolute",
    height: 2,
    borderRadius: 1,
    transformOrigin: "left center",
  },
  dot: {
    position: "absolute",
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  fallback: {
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
});
