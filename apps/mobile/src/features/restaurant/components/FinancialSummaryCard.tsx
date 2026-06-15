import React, { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { RestaurantCommandCenterData } from "../../../lib/restaurantCommandCenterApi";
import { formatMoney } from "../../../i18n/formatters";
import { textAlignStart } from "../../../i18n/rtl";
import { GlassCard } from "./GlassCard";
import { SectionHeroHeader } from "./SectionHeroHeader";
import { TrendBadge } from "./TrendBadge";
import { CC } from "./commandCenterTheme";

type Props = {
  financial: RestaurantCommandCenterData["financial"];
  language: string;
  onViewFullReport?: () => void;
};

function FinancialSummaryCardComponent({
  financial,
  language,
  onViewFullReport,
}: Props) {
  const { t } = useTranslation();
  const fmt = (value: number) => formatMoney(value, financial.currency, language);

  const rows = [
    { label: t("restaurant.commandCenter.financial.grossSales"), value: fmt(financial.grossSalesMonth) },
    {
      label: t("restaurant.commandCenter.financial.commissions"),
      value: fmt(financial.platformCommissionMonth),
    },
    { label: t("restaurant.commandCenter.financial.netRevenue"), value: fmt(financial.netRevenueMonth) },
  ];

  return (
    <GlassCard variant="gold" accentBar={CC.gold}>
      <SectionHeroHeader
        title={t("restaurant.commandCenter.financial.title")}
        rightSlot={
          financial.monthGrowthPct != null ? (
            <TrendBadge changePct={financial.monthGrowthPct} />
          ) : null
        }
      />

      {rows.map((row) => (
        <View key={row.label} style={styles.row}>
          <Text style={[styles.label, { textAlign: textAlignStart() }]}>{row.label}</Text>
          <Text style={styles.value}>{row.value}</Text>
        </View>
      ))}

      <View style={styles.impactBox}>
        <Text style={[styles.impactLabel, { textAlign: textAlignStart() }]}>
          {t("restaurant.commandCenter.financial.mmdImpact")}
        </Text>
        <Text style={styles.impactValue}>{fmt(financial.mmdImpactRevenue)}</Text>
      </View>

      <View style={styles.statsGrid}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{financial.newClientsMonth}</Text>
          <Text style={styles.statLabel}>{t("restaurant.commandCenter.financial.newClients")}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>
            {financial.loyalClientsPct != null ? `${financial.loyalClientsPct}%` : t("common.na")}
          </Text>
          <Text style={styles.statLabel}>{t("restaurant.commandCenter.financial.loyalClients")}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>
            {financial.repeatOrdersPct != null ? `${financial.repeatOrdersPct}%` : t("common.na")}
          </Text>
          <Text style={styles.statLabel}>{t("restaurant.commandCenter.financial.repeatOrders")}</Text>
        </View>
      </View>

      {onViewFullReport ? (
        <Pressable style={styles.actionBtn} onPress={onViewFullReport}>
          <Text style={styles.actionText}>{t("restaurant.commandCenter.viewFullReport")}</Text>
        </Pressable>
      ) : null}
    </GlassCard>
  );
}

export const FinancialSummaryCard = memo(FinancialSummaryCardComponent);

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  label: {
    color: CC.textSecondary,
    fontSize: 13,
    flex: 1,
  },
  value: {
    color: CC.textPrimary,
    fontWeight: "900",
    fontSize: 13,
  },
  impactBox: {
    marginTop: 6,
    padding: 14,
    borderRadius: 16,
    backgroundColor: CC.purpleGlow,
    borderWidth: 1,
    borderColor: CC.glassBorder,
  },
  impactLabel: {
    color: CC.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  impactValue: {
    color: CC.green,
    fontSize: 22,
    fontWeight: "900",
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: "row",
    gap: 8,
    marginTop: 14,
  },
  statItem: {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    backgroundColor: CC.bgElevated,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  statValue: {
    color: CC.textPrimary,
    fontWeight: "900",
    fontSize: 16,
  },
  statLabel: {
    color: CC.textMuted,
    fontSize: 10,
    marginTop: 4,
    textAlign: "center",
    fontWeight: "600",
  },
  actionBtn: {
    marginTop: 16,
    backgroundColor: CC.purpleGlow,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: CC.glassBorder,
  },
  actionText: {
    color: CC.purpleLight,
    fontWeight: "900",
    fontSize: 14,
  },
});
