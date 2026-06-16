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
import { CC, LIVE_OPS_STATUS, liveOpsCardStyle } from "./commandCenterTheme";
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
  const status = LIVE_OPS_STATUS[variant];

  useEffect(() => {
    if (variant !== "arrived") return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, variant]);

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

  const CardWrap = variant === "arrived" ? Animated.View : View;
  const cardStyle = liveOpsCardStyle(variant);
  const wrapProps =
    variant === "arrived"
      ? {
          style: [
            cardStyle,
            {
              transform: [
                {
                  scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.015] }),
                },
              ],
            },
          ],
        }
      : { style: cardStyle };

  return (
    <CardWrap {...wrapProps}>
      {variant === "arrived" ? (
        <Animated.View
          style={[
            styles.pulseRing,
            {
              borderColor: status.color,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.55] }),
              transform: [
                {
                  scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }),
                },
              ],
            },
          ]}
        />
      ) : null}

      <View style={[styles.statusHeader, { flexDirection: rowDirection() }]}>
        <Text style={styles.statusDot}>{status.dot}</Text>
        <View style={[styles.statusChip, { backgroundColor: status.tint, borderColor: status.border }]}>
          <Text style={[styles.statusChipText, { color: status.color }]}>{t(badgeKey)}</Text>
        </View>
        <Text style={styles.orderLabel}>{card.orderLabel}</Text>
      </View>

      {card.etaMinutes != null && variant !== "arrived" ? (
        <View style={[styles.etaBanner, { backgroundColor: status.tint, borderColor: status.border }]}>
          <Text style={[styles.etaValue, { color: status.color }]}>
            {t("restaurant.commandCenter.etaMinutes", { minutes: card.etaMinutes })}
          </Text>
        </View>
      ) : null}

      <View style={[styles.bodyRow, { flexDirection: rowDirection() }]}>
        {card.driverPhotoUrl ? (
          <Image source={{ uri: card.driverPhotoUrl }} style={[styles.avatar, { borderColor: status.color }]} />
        ) : (
          <View style={[styles.avatarFallback, { borderColor: status.color }]}>
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
          style={[styles.primaryBtn, { backgroundColor: status.color }, actionLoading && styles.btnDisabled]}
          onPress={onHandOver}
          disabled={actionLoading}
        >
          <Text style={styles.primaryBtnText}>{t("restaurant.commandCenter.handOverOrder")}</Text>
        </Pressable>
      ) : onViewMap ? (
        <Pressable
          style={[styles.secondaryBtn, { borderColor: status.border, backgroundColor: status.tint }]}
          onPress={onViewMap}
        >
          <Text style={[styles.secondaryBtnText, { color: status.color }]}>
            {t("restaurant.commandCenter.viewOnMap")}
          </Text>
        </Pressable>
      ) : null}
    </CardWrap>
  );
}

export const DriverArrivalCard = memo(DriverArrivalCardComponent);

const styles = StyleSheet.create({
  pulseRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
    borderWidth: 2,
  },
  statusHeader: {
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  statusDot: {
    fontSize: 16,
  },
  statusChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  orderLabel: {
    color: CC.textPrimary,
    fontSize: 13,
    fontWeight: "900",
    marginLeft: "auto",
  },
  etaBanner: {
    alignSelf: "flex-start",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    marginBottom: 12,
  },
  etaValue: {
    fontSize: 15,
    fontWeight: "900",
  },
  bodyRow: {
    alignItems: "center",
    gap: 14,
    marginBottom: 16,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2.5,
  },
  avatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: CC.purpleGlow,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
  },
  avatarInitial: {
    color: CC.textPrimary,
    fontWeight: "900",
    fontSize: 22,
  },
  meta: {
    flex: 1,
  },
  driverName: {
    color: CC.textPrimary,
    fontSize: 18,
    fontWeight: "900",
  },
  rating: {
    color: CC.gold,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 2,
  },
  subtitle: {
    color: CC.textMuted,
    fontSize: 12,
    marginTop: 4,
    lineHeight: 17,
  },
  primaryBtn: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    ...CC.shadow,
  },
  secondaryBtn: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
  },
  primaryBtnText: {
    color: CC.bg,
    fontWeight: "900",
    fontSize: 14,
  },
  secondaryBtnText: {
    fontWeight: "900",
    fontSize: 14,
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
