import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { GlassCard } from "./GlassCard";
import { MiniSparkline } from "./MiniSparkline";
import { TrendBadge } from "./TrendBadge";
import { CC } from "./commandCenterTheme";
import { textAlignStart } from "../../../i18n/rtl";

type Props = {
  revenueToday: string;
  revenueYesterday: number;
  revenueTodayRaw: number;
  changePct: number | null;
  changeLabel: string | null;
  restaurantName: string;
};

function RevenueHeroCardComponent({
  revenueToday,
  revenueYesterday,
  revenueTodayRaw,
  changePct,
  changeLabel,
  restaurantName,
}: Props) {
  const { t } = useTranslation();

  return (
    <GlassCard variant="hero" accentBar={CC.gold} style={styles.card}>
      <View style={styles.glow} />
      <Text style={[styles.eyebrow, { textAlign: textAlignStart() }]}>
        {restaurantName}
      </Text>
      <Text style={[styles.title, { textAlign: textAlignStart() }]}>
        {t("restaurant.commandCenter.revenueToday")}
      </Text>
      <View style={styles.row}>
        <Text style={[styles.amount, { textAlign: textAlignStart() }]}>{revenueToday}</Text>
        <MiniSparkline
          values={[revenueYesterday, revenueTodayRaw]}
          color={CC.purpleLight}
          width={88}
          height={36}
        />
      </View>
      <View style={styles.metaRow}>
        <TrendBadge changePct={changePct} label={changeLabel} />
      </View>
    </GlassCard>
  );
}

export const RevenueHeroCard = memo(RevenueHeroCardComponent);

const styles = StyleSheet.create({
  card: {
    paddingVertical: 20,
    paddingHorizontal: 18,
  },
  glow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(124,58,237,0.12)",
    borderRadius: 24,
  },
  eyebrow: {
    color: CC.gold,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  title: {
    color: CC.textSecondary,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
  },
  amount: {
    color: CC.textPrimary,
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: -0.5,
    flex: 1,
  },
  metaRow: {
    marginTop: 12,
  },
});
