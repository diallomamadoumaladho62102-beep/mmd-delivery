import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { CC } from "./commandCenterTheme";
import { textAlignStart } from "../../../i18n/rtl";

type Props = {
  averageMinutes: number | null;
  targetMinutes: number;
  percentileBetterThan: number | null;
};

function PrepTimeGaugeComponent({
  averageMinutes,
  targetMinutes,
  percentileBetterThan,
}: Props) {
  const { t } = useTranslation();
  const progress =
    averageMinutes != null && targetMinutes > 0
      ? Math.min(1, averageMinutes / targetMinutes)
      : 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.ring}>
        <View style={[styles.progressArc, { opacity: 0.25 + progress * 0.75 }]} />
        <View style={styles.inner}>
          <Text style={styles.value}>
            {averageMinutes != null
              ? t("restaurant.commandCenter.minutesUnit", { value: averageMinutes })
              : t("common.na")}
          </Text>
        </View>
      </View>
      <Text style={[styles.target, { textAlign: textAlignStart() }]}>
        {t("restaurant.commandCenter.prepTimeTarget", { minutes: targetMinutes })}
      </Text>
      {percentileBetterThan != null ? (
        <Text style={[styles.good, { textAlign: textAlignStart() }]}>
          {t("restaurant.commandCenter.prepTimeGood", { percent: percentileBetterThan })}
        </Text>
      ) : null}
    </View>
  );
}

export const PrepTimeGauge = memo(PrepTimeGaugeComponent);

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    gap: 8,
  },
  ring: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 6,
    borderColor: "rgba(167,139,250,0.25)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(124,58,237,0.08)",
  },
  progressArc: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 48,
    borderWidth: 6,
    borderColor: CC.purpleLight,
  },
  inner: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  value: {
    color: CC.purpleLight,
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
  },
  target: {
    color: CC.textMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  good: {
    color: CC.green,
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
});
