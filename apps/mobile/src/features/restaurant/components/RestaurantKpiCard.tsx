import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { textAlignStart } from "../../../i18n/rtl";

type Props = {
  title: string;
  value: string;
  changeLabel?: string | null;
  accent?: "purple" | "blue" | "green" | "orange" | "gold";
  loading?: boolean;
};

const ACCENTS = {
  purple: "#A78BFA",
  blue: "#60A5FA",
  green: "#4ADE80",
  orange: "#FB923C",
  gold: "#FBBF24",
};

function RestaurantKpiCardComponent({
  title,
  value,
  changeLabel,
  accent = "purple",
  loading,
}: Props) {
  const { t } = useTranslation();

  return (
    <View style={styles.card}>
      <Text style={[styles.title, { textAlign: textAlignStart() }]} numberOfLines={2}>
        {title}
      </Text>
      <Text style={[styles.value, { textAlign: textAlignStart(), color: ACCENTS[accent] }]}>
        {loading ? t("common.na") : value}
      </Text>
      {changeLabel ? (
        <Text style={[styles.change, { textAlign: textAlignStart() }]} numberOfLines={1}>
          {changeLabel}
        </Text>
      ) : null}
    </View>
  );
}

export const RestaurantKpiCard = memo(RestaurantKpiCardComponent);

const styles = StyleSheet.create({
  card: {
    minWidth: 148,
    flex: 1,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.18)",
  },
  title: {
    color: "rgba(226,232,240,0.72)",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 8,
  },
  value: {
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 4,
  },
  change: {
    color: "rgba(148,163,184,0.95)",
    fontSize: 11,
    fontWeight: "600",
  },
});
