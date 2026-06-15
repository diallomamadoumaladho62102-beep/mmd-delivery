import React, { memo } from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { CommandCenterDriverCard } from "../../../lib/restaurantCommandCenterApi";
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

  const borderColor =
    variant === "arrived"
      ? "rgba(34,197,94,0.45)"
      : variant === "approaching"
        ? "rgba(251,146,60,0.45)"
        : "rgba(96,165,250,0.45)";

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

  return (
    <View style={[styles.card, { borderColor }]}>
      <View style={[styles.headerRow, { flexDirection: rowDirection() }]}>
        <Text style={styles.badge}>{t(badgeKey)}</Text>
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
        <TouchableOpacity
          style={[styles.primaryBtn, actionLoading && styles.btnDisabled]}
          onPress={onHandOver}
          disabled={actionLoading}
        >
          <Text style={styles.primaryBtnText}>
            {t("restaurant.commandCenter.handOverOrder")}
          </Text>
        </TouchableOpacity>
      ) : onViewMap ? (
        <TouchableOpacity style={styles.secondaryBtn} onPress={onViewMap}>
          <Text style={styles.secondaryBtnText}>{t("restaurant.commandCenter.viewOnMap")}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export const DriverArrivalCard = memo(DriverArrivalCardComponent);

const styles = StyleSheet.create({
  card: {
    width: 260,
    marginRight: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
  },
  headerRow: {
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  badge: {
    color: "#F8FAFC",
    fontSize: 12,
    fontWeight: "800",
    flex: 1,
  },
  orderLabel: {
    color: "rgba(167,139,250,0.95)",
    fontSize: 12,
    fontWeight: "800",
  },
  bodyRow: {
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(124,58,237,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    color: "#FFF",
    fontWeight: "900",
    fontSize: 16,
  },
  meta: {
    flex: 1,
  },
  driverName: {
    color: "#F8FAFC",
    fontSize: 15,
    fontWeight: "800",
  },
  rating: {
    color: "#FBBF24",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  subtitle: {
    color: "rgba(148,163,184,0.95)",
    fontSize: 12,
    marginTop: 4,
  },
  primaryBtn: {
    backgroundColor: "rgba(34,197,94,0.92)",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  secondaryBtn: {
    backgroundColor: "rgba(124,58,237,0.25)",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.35)",
  },
  primaryBtnText: {
    color: "#FFF",
    fontWeight: "800",
    fontSize: 13,
  },
  secondaryBtnText: {
    color: "#DDD6FE",
    fontWeight: "800",
    fontSize: 13,
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
