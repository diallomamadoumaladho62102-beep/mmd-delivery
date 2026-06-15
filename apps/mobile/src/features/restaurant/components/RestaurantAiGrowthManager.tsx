import React, { memo } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { RestaurantAiGrowthData } from "../../../lib/restaurantCommandCenterApi";
import { formatMoney } from "../../../i18n/formatters";
import { textAlignStart } from "../../../i18n/rtl";

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
    <View style={styles.card}>
      <Text style={[styles.title, { textAlign: textAlignStart() }]}>
        {t("restaurant.commandCenter.ai.title")}
      </Text>
      <Text style={[styles.subtitle, { textAlign: textAlignStart() }]}>
        {t("restaurant.commandCenter.ai.beta")}
      </Text>

      {loading ? (
        <Text style={styles.empty}>{t("restaurant.commandCenter.loading")}</Text>
      ) : !data || !data.hasEnoughData ? (
        <Text style={styles.empty}>{t("restaurant.commandCenter.ai.notEnoughData")}</Text>
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
              <TouchableOpacity style={styles.actionBtn} onPress={onViewInventory}>
                <Text style={styles.actionText}>{t(item.actionKey)}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))
      )}
    </View>
  );
}

export const RestaurantAiGrowthManager = memo(RestaurantAiGrowthManagerComponent);

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 16,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.25)",
  },
  title: {
    color: "#FBBF24",
    fontSize: 17,
    fontWeight: "900",
  },
  subtitle: {
    color: "rgba(148,163,184,0.95)",
    fontSize: 12,
    marginTop: 4,
    marginBottom: 12,
  },
  empty: {
    color: "rgba(148,163,184,0.95)",
    fontSize: 13,
  },
  recoCard: {
    marginTop: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "rgba(2,6,23,0.55)",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.15)",
  },
  recoTitle: {
    color: "#F8FAFC",
    fontWeight: "800",
    fontSize: 14,
    marginBottom: 4,
  },
  recoBody: {
    color: "rgba(226,232,240,0.82)",
    fontSize: 12,
    lineHeight: 18,
  },
  gain: {
    color: "#4ADE80",
    fontWeight: "800",
    fontSize: 12,
    marginTop: 8,
  },
  actionBtn: {
    marginTop: 10,
    alignSelf: "flex-start",
    backgroundColor: "rgba(124,58,237,0.35)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.35)",
  },
  actionText: {
    color: "#DDD6FE",
    fontWeight: "800",
    fontSize: 12,
  },
});
