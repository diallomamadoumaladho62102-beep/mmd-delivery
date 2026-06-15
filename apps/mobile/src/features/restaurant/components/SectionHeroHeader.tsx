import React, { memo, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CC } from "./commandCenterTheme";
import { textAlignStart } from "../../../i18n/rtl";

type Props = {
  title: string;
  subtitle?: string;
  badge?: string;
  badgeColor?: string;
  rightSlot?: ReactNode;
};

function SectionHeroHeaderComponent({
  title,
  subtitle,
  badge,
  badgeColor = CC.purpleLight,
  rightSlot,
}: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.copy}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { textAlign: textAlignStart() }]}>{title}</Text>
          {badge ? (
            <View style={[styles.badge, { backgroundColor: `${badgeColor}22`, borderColor: `${badgeColor}55` }]}>
              <Text style={[styles.badgeText, { color: badgeColor }]}>{badge}</Text>
            </View>
          ) : null}
        </View>
        {subtitle ? (
          <Text style={[styles.subtitle, { textAlign: textAlignStart() }]}>{subtitle}</Text>
        ) : null}
      </View>
      {rightSlot}
    </View>
  );
}

export const SectionHeroHeader = memo(SectionHeroHeaderComponent);

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 12,
  },
  copy: {
    flex: 1,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  title: {
    color: CC.textPrimary,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  subtitle: {
    color: CC.textMuted,
    fontSize: 12,
    marginTop: 4,
    lineHeight: 18,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
});
