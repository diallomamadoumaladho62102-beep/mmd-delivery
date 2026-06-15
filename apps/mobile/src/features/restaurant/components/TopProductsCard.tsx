import React, { memo } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { CommandCenterTopProduct } from "../../../lib/restaurantCommandCenterApi";
import { formatMoney } from "../../../i18n/formatters";
import { rowDirection, textAlignStart } from "../../../i18n/rtl";

type Props = {
  products: CommandCenterTopProduct[];
  language: string;
  loading?: boolean;
};

function TopProductsCardComponent({ products, language, loading }: Props) {
  const { t } = useTranslation();

  return (
    <View style={styles.card}>
      <Text style={[styles.title, { textAlign: textAlignStart() }]}>
        {t("restaurant.commandCenter.topProducts")}
      </Text>

      {loading ? (
        <Text style={styles.empty}>{t("restaurant.commandCenter.loading")}</Text>
      ) : products.length === 0 ? (
        <Text style={styles.empty}>{t("restaurant.commandCenter.topProductsEmpty")}</Text>
      ) : (
        products.map((product, index) => (
          <View
            key={`${product.name}-${index}`}
            style={[styles.row, { flexDirection: rowDirection() }]}
          >
            <Text style={styles.rank}>{index + 1}</Text>
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
        ))
      )}
    </View>
  );
}

export const TopProductsCard = memo(TopProductsCardComponent);

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 16,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.18)",
  },
  title: {
    color: "#F8FAFC",
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 12,
  },
  empty: {
    color: "rgba(148,163,184,0.95)",
    fontSize: 13,
  },
  row: {
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  rank: {
    width: 18,
    color: "#A78BFA",
    fontWeight: "900",
    fontSize: 13,
  },
  image: {
    width: 42,
    height: 42,
    borderRadius: 10,
  },
  imageFallback: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: "rgba(124,58,237,0.25)",
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
    color: "#F8FAFC",
    fontWeight: "800",
    fontSize: 14,
  },
  detail: {
    color: "rgba(148,163,184,0.95)",
    fontSize: 12,
    marginTop: 2,
  },
});
