import React, { memo, useMemo } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { CommandCenterTopProduct } from "../../../lib/restaurantCommandCenterApi";
import { formatMoney } from "../../../i18n/formatters";
import { rowDirection, textAlignStart } from "../../../i18n/rtl";
import { GlassCard } from "./GlassCard";
import { SectionHeroHeader } from "./SectionHeroHeader";
import { CC } from "./commandCenterTheme";

type Props = {
  products: CommandCenterTopProduct[];
  language: string;
  loading?: boolean;
};

function TopProductsCardComponent({ products, language, loading }: Props) {
  const { t } = useTranslation();
  const maxQty = useMemo(
    () => Math.max(...products.map((p) => p.quantitySold), 1),
    [products]
  );

  return (
    <GlassCard variant="gold" accentBar={CC.gold}>
      <SectionHeroHeader title={t("restaurant.commandCenter.topProducts")} />

      {loading ? (
        <Text style={styles.empty}>{t("restaurant.commandCenter.loading")}</Text>
      ) : products.length === 0 ? (
        <Text style={styles.empty}>{t("restaurant.commandCenter.topProductsEmpty")}</Text>
      ) : (
        products.map((product, index) => {
          const barPct = Math.round((product.quantitySold / maxQty) * 100);
          return (
            <View key={`${product.name}-${index}`} style={styles.rowWrap}>
              <View style={[styles.row, { flexDirection: rowDirection() }]}>
                <View style={styles.rankBadge}>
                  <Text style={styles.rank}>{index + 1}</Text>
                </View>
                {product.imageUrl ? (
                  <Image source={{ uri: product.imageUrl }} style={styles.image} />
                ) : (
                  <View style={styles.imageFallback}>
                    <Text style={styles.imageFallbackText}>🍽️</Text>
                  </View>
                )}
                <View style={styles.meta}>
                  <Text style={[styles.name, { textAlign: textAlignStart() }]} numberOfLines={1}>
                    {product.name}
                  </Text>
                  <Text style={[styles.detail, { textAlign: textAlignStart() }]}>
                    {t("restaurant.commandCenter.productSoldMeta", {
                      quantity: product.quantitySold,
                      revenue: formatMoney(product.revenue, product.currency, language),
                    })}
                  </Text>
                </View>
              </View>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${barPct}%` as `${number}%` }]} />
              </View>
            </View>
          );
        })
      )}
    </GlassCard>
  );
}

export const TopProductsCard = memo(TopProductsCardComponent);

const styles = StyleSheet.create({
  empty: {
    color: CC.textMuted,
    fontSize: 13,
  },
  rowWrap: {
    marginBottom: 14,
    gap: 8,
  },
  row: {
    alignItems: "center",
    gap: 10,
  },
  rankBadge: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: CC.goldDim,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: CC.glassBorderGold,
  },
  rank: {
    color: CC.gold,
    fontWeight: "900",
    fontSize: 12,
  },
  image: {
    width: 44,
    height: 44,
    borderRadius: 12,
  },
  imageFallback: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: CC.purpleGlow,
    alignItems: "center",
    justifyContent: "center",
  },
  imageFallbackText: {
    fontSize: 18,
  },
  meta: {
    flex: 1,
  },
  name: {
    color: CC.textPrimary,
    fontWeight: "900",
    fontSize: 14,
  },
  detail: {
    color: CC.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  barTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    overflow: "hidden",
    marginLeft: 34,
  },
  barFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: CC.gold,
  },
});
