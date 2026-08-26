import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useReduceMotion } from "../../hooks/useReduceMotion";
import {
  MMD_FONT,
  MMD_GLASS,
  MMD_GOLD_CLASSIC_BORDER,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../../theme/mmdUi";
import { textAlignStart } from "../../i18n/rtl";

type Props = {
  title: string;
  subtitle?: string | null;
  detail?: string | null;
  doneBadge?: string | null;
  searching?: boolean;
};

export const TrackingStatusBanner = React.memo(function TrackingStatusBanner({
  title,
  subtitle,
  detail,
  doneBadge,
  searching,
}: Props) {
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    if (reduceMotion || !searching) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 1100,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion, searching]);

  return (
    <View style={styles.card} accessibilityRole="summary">
      <View style={styles.header}>
        {searching ? (
          <Animated.View style={{ opacity: pulse }}>
            <Ionicons name="search" size={22} color={MMD_WHITE} />
          </Animated.View>
        ) : null}
        <Text style={styles.title} numberOfLines={3}>
          {title}
        </Text>
      </View>
      {subtitle ? (
        <Text style={styles.subtitle} numberOfLines={3}>
          {subtitle}
        </Text>
      ) : null}
      {detail ? (
        <Text style={styles.detail} numberOfLines={4}>
          {detail}
        </Text>
      ) : null}
      {doneBadge ? (
        <View style={styles.doneBadge}>
          <Text style={styles.doneLabel}>{doneBadge}</Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: MMD_GLASS,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
    padding: 16,
    gap: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  title: {
    flex: 1,
    color: MMD_WHITE,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
    textAlign: textAlignStart(),
  },
  subtitle: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 16,
    fontWeight: "600",
    fontFamily: MMD_FONT.semibold,
    textAlign: textAlignStart(),
  },
  detail: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 14,
    fontWeight: "600",
    fontFamily: MMD_FONT.semibold,
    textAlign: textAlignStart(),
  },
  doneBadge: {
    alignSelf: "flex-start",
    backgroundColor: MMD_TAXI_GREEN,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  doneLabel: {
    color: MMD_WHITE,
    fontSize: 14,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
  },
});
