import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { NavigationStage } from "../../lib/driverNavigation/types";
import { resolveHudTopPadding } from "../../lib/navigationSafeArea";
import {
  MMD_FONT,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../../theme/mmdUi";

type Props = {
  visible: boolean;
  stage: NavigationStage;
  address: string;
  remainingMeters?: number | null;
  onOpenOrderDetails: () => void;
  /**
   * Extra offset below the safe HUD top (e.g. to clear nav controls).
   * Banner is always anchored at the TOP — never under speed/radar chrome.
   */
  topOffsetExtra?: number;
};

export function DriverArrivalBanner({
  visible,
  stage,
  address,
  remainingMeters,
  onOpenOrderDetails,
  topOffsetExtra = 0,
}: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  if (!visible) return null;

  const isPickup = stage === "pickup";
  const title = isPickup
    ? t("driver.arrival.pickupTitle", "Arrived at pickup")
    : t("driver.arrival.dropoffTitle", "Arrived at drop-off");
  const stageLabel = isPickup
    ? t("driver.arrival.pickupLabel", "PICKUP")
    : t("driver.arrival.dropoffLabel", "DROP-OFF");
  const body = isPickup
    ? t(
        "driver.arrival.pickupBody",
        "Confirm the meeting point, then open order details to continue.",
      )
    : t(
        "driver.arrival.dropoffBody",
        "Confirm the destination, then open order details to complete.",
      );

  const distanceLabel =
    remainingMeters != null &&
    Number.isFinite(remainingMeters) &&
    remainingMeters >= 0
      ? remainingMeters < 1000
        ? `${Math.round(remainingMeters)} m`
        : `${(remainingMeters / 1000).toFixed(1)} km`
      : null;

  const top = resolveHudTopPadding(insets.top) + Math.max(0, topOffsetExtra);

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 14,
        right: 14,
        top,
        zIndex: 40,
      }}
      accessibilityRole="summary"
      accessibilityLabel={`${title}. ${address}`}
    >
      <View
        style={{
          borderRadius: 18,
          paddingHorizontal: 14,
          paddingTop: 12,
          paddingBottom: 12,
          backgroundColor: "rgba(5,46,22,0.97)",
          borderWidth: 1,
          borderColor: "rgba(34,197,94,0.5)",
          shadowColor: "#000",
          shadowOpacity: 0.25,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 3 },
          elevation: 8,
          maxWidth: 560,
          alignSelf: "center",
          width: "100%",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
          }}
        >
          <Text style={{ fontSize: 18 }}>{isPickup ? "📍" : "🏁"}</Text>
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 999,
              backgroundColor: "rgba(34,197,94,0.25)",
            }}
          >
            <Text
              style={{
                color: "#86EFAC",
                fontSize: 11,
                fontFamily: MMD_FONT.extrabold,
                fontWeight: "800",
                letterSpacing: 0.4,
              }}
            >
              {stageLabel}
            </Text>
          </View>
          {distanceLabel ? (
            <Text
              style={{
                color: "#BBF7D0",
                fontSize: 12,
                fontFamily: MMD_FONT.semibold,
                fontWeight: "600",
              }}
            >
              {distanceLabel}
            </Text>
          ) : null}
        </View>

        <Text
          style={{
            color: MMD_WHITE,
            fontSize: 16,
            fontFamily: MMD_FONT.extrabold,
            fontWeight: "800",
          }}
        >
          {title}
        </Text>

        <Text
          style={{
            color: MMD_WHITE,
            fontSize: 15,
            fontFamily: MMD_FONT.bold,
            fontWeight: "700",
            marginTop: 6,
            lineHeight: 20,
          }}
          numberOfLines={3}
        >
          {address || "—"}
        </Text>

        <Text
          style={{
            color: "#BBF7D0",
            fontSize: 12,
            marginTop: 6,
            lineHeight: 16,
            fontFamily: MMD_FONT.regular,
          }}
          numberOfLines={2}
        >
          {body}
        </Text>

        <TouchableOpacity
          onPress={onOpenOrderDetails}
          activeOpacity={0.88}
          accessibilityRole="button"
          accessibilityLabel={t(
            "driver.arrival.openDetails",
            "Open order details",
          )}
          style={{
            marginTop: 10,
            borderRadius: 14,
            paddingVertical: 12,
            alignItems: "center",
            backgroundColor: MMD_TAXI_GREEN,
            minHeight: 44,
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: "#052E16",
              fontSize: 14,
              fontFamily: MMD_FONT.extrabold,
              fontWeight: "800",
            }}
          >
            {t("driver.arrival.openDetails", "Open order details")}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
