import React, { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { RestaurantAiGrowthData } from "../../../lib/restaurantCommandCenterApi";
import { formatMoney } from "../../../i18n/formatters";
import { textAlignStart } from "../../../i18n/rtl";
import { GlassCard } from "./GlassCard";
import { SectionHeroHeader } from "./SectionHeroHeader";
import { CC } from "./commandCenterTheme";

type Props = {
  data: RestaurantAiGrowthData | null;
  language: string;
  onViewInventory?: () => void;
  loading?: boolean;
};

function RestaurantAiGrowthManagerComponent({
  data,
  language,
  onViewInventory,
  loading,
}: Props) {
  const { t } = useTranslation();

  return (
    <GlassCard variant="gold" accentBar={CC.gold}>
      <SectionHeroHeader
        title={t("restaurant.commandCenter.ai.title")}
        subtitle={t("restaurant.commandCenter.ai.beta")}
        badge={t("restaurant.commandCenter.ai.heroBadge")}
        badgeColor={CC.gold}
      />

      {loading ? (
        <Text style={styles.empty}>{t("restaurant.commandCenter.loading")}</Text>
      ) : !data || !data.hasEnoughData ? (
        <View style={styles.emptyBox}>
          <Text style={[styles.empty, { textAlign: textAlignStart() }]}>
            {t("restaurant.commandCenter.ai.notEnoughData")}
          </Text>
        </View>
      ) : (
        data.recommendations.map((item) => (
          <View key={item.id} style={styles.recoCard}>
            <Text style={[styles.recoTitle, { textAlign: textAlignStart() }]}>
              {t(item.titleKey)}
            </Text>
            <Text style={[styles.recoBody, { textAlign: textAlignStart() }]}>
              {t(
                item.bodyKey,
                item.type === "best_product" && typeof item.params.revenue === "number"
                  ? {
                      ...item.params,
                      revenue: formatMoney(item.params.revenue, item.currency, language),
                    }
                  : item.params
              )}
            </Text>
            {item.estimatedGain != null ? (
              <Text style={[styles.gain, { textAlign: textAlignStart() }]}>
                {t("restaurant.commandCenter.ai.estimatedGain", {
                  amount: formatMoney(item.estimatedGain, item.currency, language),
                })}
              </Text>
            ) : null}
            {item.actionKey && item.actionRoute === "inventory" && onViewInventory ? (
              <Pressable style={styles.actionBtn} onPress={onViewInventory}>
                <Text style={styles.actionText}>{t(item.actionKey)}</Text>
              </Pressable>
            ) : null}
          </View>
        ))
      )}
    </GlassCard>
  );
}

export const RestaurantAiGrowthManager = memo(RestaurantAiGrowthManagerComponent);

const styles = StyleSheet.create({
  emptyBox: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: CC.bgElevated,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  empty: {
    color: CC.textMuted,
    fontSize: 13,
    lineHeight: 20,
  },
  recoCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: CC.bgElevated,
    borderWidth: 1,
    borderColor: CC.glassBorder,
  },
  recoTitle: {
    color: CC.gold,
    fontWeight: "900",
    fontSize: 14,
    marginBottom: 6,
  },
  recoBody: {
    color: CC.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  gain: {
    color: CC.green,
    fontWeight: "900",
    fontSize: 12,
    marginTop: 10,
  },
  actionBtn: {
    marginTop: 12,
    alignSelf: "flex-start",
    backgroundColor: CC.purpleGlow,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: CC.glassBorder,
  },
  actionText: {
    color: CC.purpleLight,
    fontWeight: "900",
    fontSize: 12,
  },
});
