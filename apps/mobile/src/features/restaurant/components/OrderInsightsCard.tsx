import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { RestaurantCommandCenterData } from "../../../lib/restaurantCommandCenterApi";
import { GlassCard } from "./GlassCard";
import { OrderDistributionDonut, buildDonutSlices } from "./OrderDistributionDonut";
import { PrepTimeGauge } from "./PrepTimeGauge";
import { SectionHeroHeader } from "./SectionHeroHeader";
import { CC } from "./commandCenterTheme";
import { textAlignStart } from "../../../i18n/rtl";

type Props = {
  orderStatusBreakdown: RestaurantCommandCenterData["orderStatusBreakdown"];
  ordersToday: number;
  prepTime: RestaurantCommandCenterData["prepTime"];
  statusLabel: (status: string) => string;
};

function OrderInsightsCardComponent({
  orderStatusBreakdown,
  ordersToday,
  prepTime,
  statusLabel,
}: Props) {
  const { t } = useTranslation();
  const slices = buildDonutSlices(orderStatusBreakdown, statusLabel);

  return (
    <GlassCard variant="default" style={styles.card}>
      <SectionHeroHeader title={t("restaurant.commandCenter.ordersOverview")} />
      {orderStatusBreakdown.length === 0 ? (
        <Text style={[styles.empty, { textAlign: textAlignStart() }]}>
          {t("restaurant.commandCenter.liveOperationsEmpty")}
        </Text>
      ) : (
        <View style={styles.grid}>
          <OrderDistributionDonut slices={slices} totalOrders={ordersToday} />
          <View style={styles.prepCol}>
            <Text style={[styles.prepTitle, { textAlign: textAlignStart() }]}>
              {t("restaurant.commandCenter.prepTime")}
            </Text>
            <PrepTimeGauge
              averageMinutes={prepTime.averageMinutes}
              targetMinutes={prepTime.targetMinutes}
              percentileBetterThan={prepTime.percentileBetterThan}
            />
          </View>
        </View>
      )}
    </GlassCard>
  );
}

export const OrderInsightsCard = memo(OrderInsightsCardComponent);

const styles = StyleSheet.create({
  card: {
    paddingBottom: 18,
  },
  empty: {
    color: CC.textMuted,
    fontSize: 13,
  },
  grid: {
    gap: 18,
  },
  prepCol: {
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
    paddingTop: 16,
  },
  prepTitle: {
    color: CC.textPrimary,
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 8,
    alignSelf: "stretch",
  },
});
