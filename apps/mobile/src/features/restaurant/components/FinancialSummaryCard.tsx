import React, { memo } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { RestaurantCommandCenterData } from "../../../lib/restaurantCommandCenterApi";
import { formatMoney } from "../../../i18n/formatters";
import { textAlignStart } from "../../../i18n/rtl";

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
    <View style={styles.card}>
      <Text style={[styles.title, { textAlign: textAlignStart() }]}>
        {t("restaurant.commandCenter.financial.title")}
      </Text>

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
        <TouchableOpacity style={styles.actionBtn} onPress={onViewFullReport}>
          <Text style={styles.actionText}>{t("restaurant.commandCenter.viewFullReport")}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export const FinancialSummaryCard = memo(FinancialSummaryCardComponent);

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 16,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.22)",
  },
  title: {
    color: "#FBBF24",
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  label: {
    color: "rgba(148,163,184,0.95)",
    fontSize: 13,
    flex: 1,
  },
  value: {
    color: "#F8FAFC",
    fontWeight: "800",
    fontSize: 13,
  },
  impactBox: {
    marginTop: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "rgba(124,58,237,0.18)",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.25)",
  },
  impactLabel: {
    color: "rgba(226,232,240,0.85)",
    fontSize: 12,
    fontWeight: "700",
  },
  impactValue: {
    color: "#4ADE80",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  statItem: {
    flex: 1,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "rgba(2,6,23,0.55)",
    alignItems: "center",
  },
  statValue: {
    color: "#F8FAFC",
    fontWeight: "900",
    fontSize: 15,
  },
  statLabel: {
    color: "rgba(148,163,184,0.95)",
    fontSize: 10,
    marginTop: 4,
    textAlign: "center",
  },
  actionBtn: {
    marginTop: 14,
    backgroundColor: "rgba(124,58,237,0.35)",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.35)",
  },
  actionText: {
    color: "#DDD6FE",
    fontWeight: "800",
    fontSize: 13,
  },
});
