import React from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { useTranslation } from "react-i18next";
import type { NavigationInstruction } from "../../lib/navigationInstructions";
import { formatNavigationDistance } from "../../lib/navigationInstructions";
import type { NavigationStage } from "../../lib/driverNavigation/types";
import type { GpsQualityStatus } from "../../lib/driverNavigation/types";

type Props = {
  visible: boolean;
  stage: NavigationStage;
  instruction: NavigationInstruction | null;
  remainingMinutes: number;
  remainingMeters: number;
  routeLoading: boolean;
  networkWeak: boolean;
  gpsStatus: GpsQualityStatus;
};

function maneuverGlyph(instruction: NavigationInstruction | null): string {
  const type = instruction?.maneuverType ?? "";
  if (type.includes("left")) return "↰";
  if (type.includes("right")) return "↱";
  if (type.includes("uturn") || type.includes("u-turn")) return "↩";
  if (type.includes("roundabout")) return "⟳";
  return "↑";
}

export function DriverNavigationHud({
  visible,
  stage,
  instruction,
  remainingMinutes,
  remainingMeters,
  routeLoading,
  networkWeak,
  gpsStatus,
}: Props) {
  const { t, i18n } = useTranslation();

  if (!visible || !instruction) return null;

  const maneuverDistance = formatNavigationDistance(
    instruction.maneuverDistanceMeters,
    i18n.language,
  );

  const gpsWarning =
    gpsStatus === "lost"
      ? t("driver.navigation.gpsLost", "GPS signal lost")
      : gpsStatus === "degraded"
        ? t("driver.navigation.gpsWeak", "GPS accuracy reduced")
        : networkWeak
          ? t("driver.navigation.networkWeak", "Weak network — ETA estimated")
          : null;

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 88,
        left: 12,
        right: 12,
        borderRadius: 26,
        paddingHorizontal: 16,
        paddingVertical: 14,
        backgroundColor: "rgba(2,6,23,0.97)",
        borderWidth: 1,
        borderColor: "rgba(96,165,250,0.45)",
      }}
    >
      <Text
        style={{
          color: stage === "pickup" ? "#93C5FD" : "#FDBA74",
          fontSize: 11,
          fontWeight: "900",
          letterSpacing: 0.6,
        }}
      >
        {stage === "pickup"
          ? t("driver.navigation.toPickup", "TO PICKUP")
          : t("driver.navigation.toDropoff", "TO DROPOFF")}
      </Text>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          marginTop: 10,
        }}
      >
        <View
          style={{
            width: 58,
            height: 58,
            borderRadius: 18,
            backgroundColor: "rgba(37,99,235,0.28)",
            alignItems: "center",
            justifyContent: "center",
            marginRight: 14,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 30, fontWeight: "900" }}>
            {maneuverGlyph(instruction)}
          </Text>
        </View>

        <View style={{ flex: 1 }}>
          <Text style={{ color: "#FFFFFF", fontSize: 28, fontWeight: "900" }}>
            {maneuverDistance}
          </Text>
          <Text
            style={{
              color: "#FFFFFF",
              fontSize: 18,
              fontWeight: "800",
              marginTop: 4,
            }}
            numberOfLines={2}
          >
            {instruction.title}
          </Text>
        </View>

        <View style={{ alignItems: "flex-end", minWidth: 72 }}>
          <Text style={{ color: "#FFFFFF", fontSize: 20, fontWeight: "900" }}>
            {remainingMinutes > 0 ? `${remainingMinutes} min` : "—"}
          </Text>
          <Text
            style={{
              color: "#93C5FD",
              fontSize: 12,
              fontWeight: "800",
              marginTop: 4,
            }}
          >
            {formatNavigationDistance(remainingMeters, i18n.language)}
          </Text>
          {routeLoading && (
            <ActivityIndicator size="small" color="#93C5FD" style={{ marginTop: 8 }} />
          )}
        </View>
      </View>

      {gpsWarning ? (
        <Text
          style={{
            color: "#FCA5A5",
            fontSize: 11,
            marginTop: 10,
            fontWeight: "800",
          }}
        >
          {gpsWarning}
        </Text>
      ) : null}
    </View>
  );
}
