import React, { memo, useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { GlassCard } from "./GlassCard";
import { MiniSparkline } from "./MiniSparkline";
import { TrendBadge } from "./TrendBadge";
import { CC } from "./commandCenterTheme";
import { rowDirection, textAlignStart } from "../../../i18n/rtl";

type Props = {
  revenueToday: string;
  revenueYesterday: number;
  revenueYesterdayFormatted: string;
  revenueTodayRaw: number;
  changePct: number | null;
  changeLabel: string | null;
  restaurantName: string;
  ordersToday: number;
  activeDrivers: number;
  liveAlerts: number;
};

function RevenueHeroCardComponent({
  revenueToday,
  revenueYesterday,
  revenueYesterdayFormatted,
  revenueTodayRaw,
  changePct,
  changeLabel,
  restaurantName,
  ordersToday,
  activeDrivers,
  liveAlerts,
}: Props) {
  const { t } = useTranslation();
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [glow]);

  const glowOpacity = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0.85],
  });

  const maxRevenue = Math.max(revenueYesterday, revenueTodayRaw, 1);
  const yesterdayBar = `${Math.round((revenueYesterday / maxRevenue) * 100)}%`;
  const todayBar = `${Math.round((revenueTodayRaw / maxRevenue) * 100)}%`;

  return (
    <GlassCard variant="hero" accentBar={CC.gold} style={styles.card}>
      <Animated.View
        style={[styles.glowPurple, { opacity: glowOpacity }]}
        pointerEvents="none"
      />
      <Animated.View
        style={[styles.glowGold, { opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.55] }) }]}
        pointerEvents="none"
      />

      <Text style={[styles.eyebrow, { textAlign: textAlignStart() }]}>{restaurantName}</Text>
      <Text style={[styles.title, { textAlign: textAlignStart() }]}>
        {t("restaurant.commandCenter.revenueToday")}
      </Text>

      <View style={[styles.amountRow, { flexDirection: rowDirection() }]}>
        <Text style={[styles.amount, { textAlign: textAlignStart() }]}>{revenueToday}</Text>
        <MiniSparkline
          values={[revenueYesterday, revenueTodayRaw]}
          color={CC.gold}
          width={112}
          height={44}
        />
      </View>

      <View style={styles.metaRow}>
        <TrendBadge changePct={changePct} label={changeLabel} />
      </View>

      <View style={[styles.compareRow, { flexDirection: rowDirection() }]}>
        <View style={styles.compareCol}>
          <Text style={[styles.compareLabel, { textAlign: textAlignStart() }]}>
            {t("restaurant.commandCenter.today")}
          </Text>
          <Text style={[styles.compareValue, { textAlign: textAlignStart() }]}>{revenueToday}</Text>
        </View>
        <View style={styles.compareDivider} />
        <View style={styles.compareCol}>
          <Text style={[styles.compareLabel, { textAlign: textAlignStart() }]}>
            {t("restaurant.commandCenter.yesterday")}
          </Text>
          <Text style={[styles.compareValueMuted, { textAlign: textAlignStart() }]}>
            {revenueYesterdayFormatted}
          </Text>
        </View>
      </View>

      <View style={styles.trendBlock}>
        <Text style={[styles.trendTitle, { textAlign: textAlignStart() }]}>
          {t("restaurant.commandCenter.revenueTrend")}
        </Text>
        <View style={styles.barRow}>
          <Text style={styles.barLegend}>{t("restaurant.commandCenter.yesterday")}</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: yesterdayBar as `${number}%`, backgroundColor: `${CC.gold}44` }]} />
          </View>
        </View>
        <View style={styles.barRow}>
          <Text style={styles.barLegend}>{t("restaurant.commandCenter.today")}</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: todayBar as `${number}%`, backgroundColor: CC.gold }]} />
          </View>
        </View>
      </View>

      <View style={[styles.glanceRow, { flexDirection: rowDirection() }]}>
        <View style={styles.glancePill}>
          <Text style={styles.glanceEmoji}>📦</Text>
          <Text style={styles.glanceValue}>{ordersToday}</Text>
          <Text style={styles.glanceLabel} numberOfLines={1}>
            {t("restaurant.commandCenter.ordersToday")}
          </Text>
        </View>
        <View style={styles.glancePill}>
          <Text style={styles.glanceEmoji}>🛵</Text>
          <Text style={[styles.glanceValue, { color: CC.blue }]}>{activeDrivers}</Text>
          <Text style={styles.glanceLabel} numberOfLines={1}>
            {t("restaurant.commandCenter.liveMap")}
          </Text>
        </View>
        <View style={styles.glancePill}>
          <Text style={styles.glanceEmoji}>⚡</Text>
          <Text style={[styles.glanceValue, { color: liveAlerts > 0 ? CC.red : CC.textMuted }]}>
            {liveAlerts}
          </Text>
          <Text style={styles.glanceLabel} numberOfLines={1}>
            {t("restaurant.commandCenter.liveOperations")}
          </Text>
        </View>
      </View>
    </GlassCard>
  );
}

export const RevenueHeroCard = memo(RevenueHeroCardComponent);

const styles = StyleSheet.create({
  card: {
    paddingVertical: 24,
    paddingHorizontal: 20,
    minHeight: 320,
  },
  glowPurple: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: CC.heroGlowPurple,
    borderRadius: 28,
  },
  glowGold: {
    position: "absolute",
    top: -40,
    right: -20,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: CC.heroGlowGold,
  },
  eyebrow: {
    color: CC.gold,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.6,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  title: {
    color: CC.textSecondary,
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 6,
  },
  amountRow: {
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 10,
  },
  amount: {
    color: CC.textPrimary,
    fontSize: 52,
    fontWeight: "900",
    letterSpacing: -1.2,
    flex: 1,
    lineHeight: 56,
  },
  metaRow: {
    marginBottom: 18,
  },
  compareRow: {
    alignItems: "stretch",
    gap: 14,
    marginBottom: 18,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.22)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.18)",
  },
  compareCol: {
    flex: 1,
  },
  compareDivider: {
    width: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  compareLabel: {
    color: CC.textMuted,
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  compareValue: {
    color: CC.textPrimary,
    fontSize: 22,
    fontWeight: "900",
  },
  compareValueMuted: {
    color: CC.textSecondary,
    fontSize: 20,
    fontWeight: "800",
  },
  trendBlock: {
    gap: 8,
    marginBottom: 16,
  },
  trendTitle: {
    color: CC.textSecondary,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.2,
    marginBottom: 2,
  },
  barRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  barLegend: {
    width: 72,
    color: CC.textMuted,
    fontSize: 10,
    fontWeight: "700",
  },
  track: {
    flex: 1,
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 999,
  },
  glanceRow: {
    gap: 10,
  },
  glancePill: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: CC.glassBorder,
    alignItems: "center",
  },
  glanceEmoji: {
    fontSize: 14,
    marginBottom: 4,
  },
  glanceValue: {
    color: CC.textPrimary,
    fontSize: 20,
    fontWeight: "900",
  },
  glanceLabel: {
    color: CC.textMuted,
    fontSize: 9,
    fontWeight: "700",
    marginTop: 4,
    textAlign: "center",
  },
});
