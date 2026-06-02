import React from "react";
import { View, Text, ActivityIndicator } from "react-native";
import type { NavigationInstruction } from "../../lib/navigationInstructions";
import type { NavigationStage } from "../../lib/driverNavigation/types";

type Props = {
  visible: boolean;
  stage: NavigationStage;
  instruction: NavigationInstruction | null;
  remainingMinutes: number;
  remainingMeters: number;
  routeLoading: boolean;
  networkWeak: boolean;
  gpsStatus: "initializing" | "active" | "degraded" | "lost";
};

function formatRemainingDistance(meters: number): string {
  if (!Number.isFinite(meters)) return "—";
  if (meters < 160) return `${Math.max(30, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1609.344).toFixed(1)} mi`;
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
  if (!visible || !instruction) return null;

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 96,
        left: 14,
        right: 14,
        borderRadius: 24,
        paddingHorizontal: 14,
        paddingVertical: 12,
        backgroundColor: "rgba(2,6,23,0.96)",
        borderWidth: 1,
        borderColor: "rgba(96,165,250,0.42)",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text
            style={{
              color: stage === "pickup" ? "#93C5FD" : "#FDBA74",
              fontSize: 11,
              fontWeight: "900",
              letterSpacing: 0.5,
            }}
          >
            {stage === "pickup" ? "VERS LE PICKUP" : "VERS LE DROPOFF"}
          </Text>
          <Text
            style={{
              color: "#FFFFFF",
              fontSize: 18,
              fontWeight: "900",
              marginTop: 3,
            }}
            numberOfLines={2}
          >
            {instruction.title}
          </Text>
          <Text style={{ color: "#CBD5E1", fontSize: 12, marginTop: 4 }}>
            {instruction.subtitle}
          </Text>
          {(networkWeak || gpsStatus === "degraded" || gpsStatus === "lost") && (
            <Text style={{ color: "#FCA5A5", fontSize: 11, marginTop: 6, fontWeight: "800" }}>
              {gpsStatus === "lost"
                ? "Signal GPS faible ou perdu"
                : networkWeak
                  ? "Réseau faible — ETA estimée"
                  : "Précision GPS réduite"}
            </Text>
          )}
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: "#FFFFFF", fontSize: 18, fontWeight: "900" }}>
            {remainingMinutes > 0 ? `${remainingMinutes} min` : "—"}
          </Text>
          <Text
            style={{
              color: "#93C5FD",
              fontSize: 12,
              fontWeight: "800",
              marginTop: 3,
            }}
          >
            {formatRemainingDistance(remainingMeters)}
          </Text>
          {routeLoading && (
            <ActivityIndicator size="small" color="#93C5FD" style={{ marginTop: 8 }} />
          )}
        </View>
      </View>
    </View>
  );
}
