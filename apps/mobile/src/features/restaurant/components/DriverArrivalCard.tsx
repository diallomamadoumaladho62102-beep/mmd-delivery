import React, { memo, useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import type { CommandCenterDriverCard } from "../../../lib/restaurantCommandCenterApi";
import { CC } from "./commandCenterTheme";
import { rowDirection, textAlignStart } from "../../../i18n/rtl";

type Props = {
  card: CommandCenterDriverCard;
  variant: "arrived" | "approaching" | "en_route";
  onHandOver?: () => void;
  onViewMap?: () => void;
  actionLoading?: boolean;
};

function DriverArrivalCardComponent({
  card,
  variant,
  onHandOver,
  onViewMap,
  actionLoading,
}: Props) {
  const { t } = useTranslation();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (variant !== "arrived") return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, variant]);

  const borderColor =
    variant === "arrived"
      ? CC.green
      : variant === "approaching"
        ? CC.orange
        : CC.blue;

  const badgeKey =
    variant === "arrived"
      ? "restaurant.commandCenter.driverArrived"
      : variant === "approaching"
        ? "restaurant.commandCenter.driverApproaching"
        : "restaurant.commandCenter.driverEnRoute";

  const subtitle =
    variant === "arrived" && card.arrivedSecondsAgo != null
      ? t("restaurant.commandCenter.arrivedAgo", {
          seconds: card.arrivedSecondsAgo,
        })
      : card.etaMinutes != null
        ? t("restaurant.commandCenter.etaMinutes", { minutes: card.etaMinutes })
        : t("restaurant.commandCenter.enRoute");

  const scale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.02],
  });

  const CardWrap = variant === "arrived" ? Animated.View : View;
  const wrapProps =
    variant === "arrived"
      ? { style: [styles.card, { borderColor, transform: [{ scale }] }] }
      : { style: [styles.card, { borderColor }] };

  return (
    <CardWrap {...wrapProps}>
      {variant === "arrived" ? (
        <Animated.View
          style={[
            styles.pulseRing,
            {
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.45] }),
              transform: [
                {
                  scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }),
                },
              ],
            },
          ]}
        />
      ) : null}

      <View style={[styles.headerRow, { flexDirection: rowDirection() }]}>
        <View style={[styles.statusChip, { backgroundColor: `${borderColor}22`, borderColor: `${borderColor}66` }]}>
          <Text style={[styles.statusChipText, { color: borderColor }]}>{t(badgeKey)}</Text>
        </View>
        <Text style={styles.orderLabel}>{card.orderLabel}</Text>
      </View>

      <View style={[styles.bodyRow, { flexDirection: rowDirection() }]}>
        {card.driverPhotoUrl ? (
          <Image source={{ uri: card.driverPhotoUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarInitial}>
              {String(card.driverName ?? "?").slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}

        <View style={styles.meta}>
          <Text style={[styles.driverName, { textAlign: textAlignStart() }]} numberOfLines={1}>
            {card.driverName}
          </Text>
          {card.driverRating != null ? (
            <Text style={[styles.rating, { textAlign: textAlignStart() }]}>
              {t("restaurant.commandCenter.driverRating", { rating: card.driverRating })}
            </Text>
          ) : null}
          <Text style={[styles.subtitle, { textAlign: textAlignStart() }]} numberOfLines={2}>
            {subtitle}
          </Text>
        </View>
      </View>

      {variant === "arrived" && onHandOver ? (
        <Pressable
          style={[styles.primaryBtn, actionLoading && styles.btnDisabled]}
          onPress={onHandOver}
          disabled={actionLoading}
        >
          <Text style={styles.primaryBtnText}>
            {t("restaurant.commandCenter.handOverOrder")}
          </Text>
        </Pressable>
      ) : onViewMap ? (
        <Pressable style={styles.secondaryBtn} onPress={onViewMap}>
          <Text style={styles.secondaryBtnText}>{t("restaurant.commandCenter.viewOnMap")}</Text>
        </Pressable>
      ) : null}
    </CardWrap>
  );
}

export const DriverArrivalCard = memo(DriverArrivalCardComponent);

const styles = StyleSheet.create({
  card: {
    width: 280,
    marginRight: 14,
    padding: 16,
    borderRadius: 22,
    backgroundColor: CC.glass,
    borderWidth: 1.5,
    overflow: "hidden",
    ...CC.shadow,
  },
  pulseRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: CC.green,
  },
  headerRow: {
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 8,
  },
  statusChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    flex: 1,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: "900",
  },
  orderLabel: {
    color: CC.purpleLight,
    fontSize: 12,
    fontWeight: "900",
  },
  bodyRow: {
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.2)",
  },
  avatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: CC.purpleGlow,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    color: CC.textPrimary,
    fontWeight: "900",
    fontSize: 18,
  },
  meta: {
    flex: 1,
  },
  driverName: {
    color: CC.textPrimary,
    fontSize: 16,
    fontWeight: "900",
  },
  rating: {
    color: CC.gold,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  subtitle: {
    color: CC.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  primaryBtn: {
    backgroundColor: "rgba(34,197,94,0.92)",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryBtn: {
    backgroundColor: CC.purpleGlow,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: CC.glassBorder,
  },
  primaryBtnText: {
    color: CC.textPrimary,
    fontWeight: "900",
    fontSize: 13,
  },
  secondaryBtnText: {
    color: CC.purpleLight,
    fontWeight: "900",
    fontSize: 13,
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
