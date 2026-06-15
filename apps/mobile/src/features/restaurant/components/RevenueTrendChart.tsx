import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { CC } from "./commandCenterTheme";
import { textAlignStart } from "../../../i18n/rtl";

type BarItem = {
  key: string;
  label: string;
  yesterday: number;
  today: number;
  format: (value: number) => string;
  color: string;
};

type Props = {
  items: BarItem[];
};

function RevenueTrendChartComponent({ items }: Props) {
  const { t } = useTranslation();

  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { textAlign: textAlignStart() }]}>
        {t("restaurant.commandCenter.revenueTrend")}
      </Text>
      {items.map((item) => {
        const max = Math.max(item.yesterday, item.today, 1);
        const yesterdayWidth = `${Math.round((item.yesterday / max) * 100)}%`;
        const todayWidth = `${Math.round((item.today / max) * 100)}%`;

        return (
          <View key={item.key} style={styles.block}>
            <Text style={[styles.label, { textAlign: textAlignStart() }]}>{item.label}</Text>
            <View style={styles.barRow}>
              <Text style={styles.barLegend}>{t("restaurant.commandCenter.yesterday")}</Text>
              <View style={styles.track}>
                <View
                  style={[
                    styles.fill,
                    {
                      width: yesterdayWidth as `${number}%`,
                      backgroundColor: `${item.color}55`,
                    },
                  ]}
                />
              </View>
              <Text style={styles.value}>{item.format(item.yesterday)}</Text>
            </View>
            <View style={styles.barRow}>
              <Text style={styles.barLegend}>{t("restaurant.commandCenter.today")}</Text>
              <View style={styles.track}>
                <View
                  style={[
                    styles.fill,
                    {
                      width: todayWidth as `${number}%`,
                      backgroundColor: item.color,
                    },
                  ]}
                />
              </View>
              <Text style={styles.value}>{item.format(item.today)}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export const RevenueTrendChart = memo(RevenueTrendChartComponent);

const styles = StyleSheet.create({
  wrap: {
    gap: 14,
  },
  title: {
    color: CC.textPrimary,
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 2,
  },
  block: {
    gap: 6,
  },
  label: {
    color: CC.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  barRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  barLegend: {
    width: 68,
    color: CC.textMuted,
    fontSize: 10,
    fontWeight: "600",
  },
  track: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 999,
  },
  value: {
    width: 72,
    textAlign: "right",
    color: CC.textPrimary,
    fontSize: 10,
    fontWeight: "800",
  },
});
