import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CC } from "./commandCenterTheme";

type Props = {
  changePct: number | null | undefined;
  label?: string | null;
};

function TrendBadgeComponent({ changePct, label }: Props) {
  if (changePct == null || !Number.isFinite(changePct)) {
    if (!label) return null;
    return (
      <View style={[styles.chip, styles.neutral]}>
        <Text style={styles.text}>{label}</Text>
      </View>
    );
  }

  const positive = changePct >= 0;
  return (
    <View style={[styles.chip, positive ? styles.up : styles.down]}>
      <Text style={[styles.text, positive ? styles.upText : styles.downText]}>
        {positive ? "▲" : "▼"} {Math.abs(changePct).toFixed(1)}%
      </Text>
      {label ? <Text style={styles.sub}>{label}</Text> : null}
    </View>
  );
}

export const TrendBadge = memo(TrendBadgeComponent);

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  up: {
    backgroundColor: CC.greenDim,
    borderColor: "rgba(34,197,94,0.35)",
  },
  down: {
    backgroundColor: CC.redDim,
    borderColor: "rgba(239,68,68,0.35)",
  },
  neutral: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: CC.glassBorder,
  },
  text: {
    fontSize: 11,
    fontWeight: "900",
  },
  upText: { color: CC.green },
  downText: { color: CC.red },
  sub: {
    color: CC.textMuted,
    fontSize: 10,
    fontWeight: "600",
  },
});
