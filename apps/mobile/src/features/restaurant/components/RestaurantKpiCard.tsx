import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { CC } from "./commandCenterTheme";
import { MiniSparkline } from "./MiniSparkline";
import { TrendBadge } from "./TrendBadge";
import { textAlignStart } from "../../../i18n/rtl";

type Props = {
  title: string;
  value: string;
  changeLabel?: string | null;
  changePct?: number | null;
  sparklineValues?: number[];
  accent?: "purple" | "blue" | "green" | "orange" | "gold";
  loading?: boolean;
};

const ACCENTS = {
  purple: CC.purpleLight,
  blue: CC.blue,
  green: CC.green,
  orange: CC.orange,
  gold: CC.gold,
};

function RestaurantKpiCardComponent({
  title,
  value,
  changeLabel,
  changePct,
  sparklineValues = [],
  accent = "purple",
  loading,
}: Props) {
  const { t } = useTranslation();
  const color = ACCENTS[accent];

  return (
    <View style={[styles.card, { borderColor: `${color}33` }]}>
      <View style={[styles.accentGlow, { backgroundColor: `${color}14` }]} />
      <Text style={[styles.title, { textAlign: textAlignStart() }]} numberOfLines={2}>
        {title}
      </Text>
      <View style={styles.valueRow}>
        <Text style={[styles.value, { textAlign: textAlignStart(), color }]}>
          {loading ? t("common.na") : value}
        </Text>
        {sparklineValues.length >= 2 ? (
          <MiniSparkline values={sparklineValues} color={color} width={56} height={28} />
        ) : null}
      </View>
      <TrendBadge changePct={changePct} label={changeLabel} />
    </View>
  );
}

export const RestaurantKpiCard = memo(RestaurantKpiCardComponent);

const styles = StyleSheet.create({
  card: {
    minWidth: 158,
    padding: 14,
    borderRadius: 20,
    backgroundColor: CC.glass,
    borderWidth: 1,
    overflow: "hidden",
    ...CC.shadow,
  },
  accentGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 48,
  },
  title: {
    color: CC.textSecondary,
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 10,
    letterSpacing: 0.2,
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 10,
  },
  value: {
    fontSize: 22,
    fontWeight: "900",
    flex: 1,
  },
});
