import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { CC, STATUS_COLORS } from "./commandCenterTheme";
import { textAlignStart } from "../../../i18n/rtl";

export type DonutSlice = {
  key: string;
  label: string;
  count: number;
  pct: number;
  color: string;
};

type Props = {
  slices: DonutSlice[];
  totalOrders: number;
};

function OrderDistributionDonutComponent({ slices, totalOrders }: Props) {
  const { t } = useTranslation();
  const active = slices.filter((slice) => slice.count > 0);

  return (
    <View style={styles.wrap}>
      <View style={styles.ringOuter}>
        <View style={styles.ringTrack}>
          {active.map((slice) => (
            <View
              key={slice.key}
              style={[
                styles.ringSegment,
                {
                  flex: Math.max(slice.count, 1),
                  backgroundColor: slice.color,
                },
              ]}
            />
          ))}
        </View>
        <View style={styles.ringInner}>
          <Text style={styles.centerValue}>{totalOrders}</Text>
          <Text style={styles.centerLabel}>
            {t("restaurant.commandCenter.ordersToday")}
          </Text>
        </View>
      </View>

      <View style={styles.legend}>
        {slices.map((slice) => (
          <View key={slice.key} style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: slice.color }]} />
            <Text style={[styles.legendLabel, { textAlign: textAlignStart() }]} numberOfLines={1}>
              {slice.label}
            </Text>
            <Text style={styles.legendValue}>
              {slice.count} · {slice.pct.toFixed(0)}%
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function buildDonutSlices(
  breakdown: Array<{ status: string; count: number; pct: number }>,
  statusLabel: (status: string) => string
): DonutSlice[] {
  return breakdown.map((row) => ({
    key: row.status,
    label: statusLabel(row.status),
    count: row.count,
    pct: row.pct,
    color: STATUS_COLORS[row.status] ?? CC.purpleLight,
  }));
}

export const OrderDistributionDonut = memo(OrderDistributionDonutComponent);

const SIZE = 132;

const styles = StyleSheet.create({
  wrap: {
    gap: 16,
  },
  ringOuter: {
    alignSelf: "center",
    width: SIZE,
    height: SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  ringTrack: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: SIZE / 2,
    overflow: "hidden",
    flexDirection: "row",
    borderWidth: 1,
    borderColor: CC.glassBorder,
  },
  ringSegment: {
    height: "100%",
  },
  ringInner: {
    width: SIZE - 34,
    height: SIZE - 34,
    borderRadius: (SIZE - 34) / 2,
    backgroundColor: CC.bgElevated,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: CC.glassBorder,
  },
  centerValue: {
    color: CC.textPrimary,
    fontSize: 24,
    fontWeight: "900",
  },
  centerLabel: {
    color: CC.textMuted,
    fontSize: 9,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 2,
    paddingHorizontal: 8,
  },
  legend: {
    gap: 8,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    flex: 1,
    color: CC.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  legendValue: {
    color: CC.textPrimary,
    fontSize: 12,
    fontWeight: "800",
  },
});
