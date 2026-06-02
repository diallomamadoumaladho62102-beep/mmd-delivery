import React from "react";
import { View, Text, TouchableOpacity, Alert } from "react-native";
import {
  openExternalNavigation,
  type ExternalNavigationProvider,
} from "../../lib/externalNavigationApps";
import type { CoordinatePoint } from "../../lib/coordinates";
import type { NavigationStage } from "../../lib/driverNavigation/types";

type Props = {
  topOffset: number;
  voiceEnabled: boolean;
  onToggleVoice: () => void;
  onRecenter: () => void;
  onOpenOrderDetails: () => void;
  stage: NavigationStage;
  destination: CoordinatePoint | null;
  destinationAddress: string;
};

function showExternalNavigationSheet(params: {
  stage: NavigationStage;
  destination: CoordinatePoint | null;
  destinationAddress: string;
}) {
  const target = {
    latitude: params.destination?.latitude ?? null,
    longitude: params.destination?.longitude ?? null,
    address: params.destinationAddress,
  };

  Alert.alert(
    params.stage === "pickup" ? "Navigation externe — Pickup" : "Navigation externe — Dropoff",
    "Continuer avec une application externe ?",
    [
      {
        text: "Google Maps",
        onPress: () => openExternalNavigation("google" as ExternalNavigationProvider, target),
      },
      {
        text: "Waze",
        onPress: () => openExternalNavigation("waze" as ExternalNavigationProvider, target),
      },
      { text: "Annuler", style: "cancel" },
    ],
  );
}

export function DriverNavigationControls({
  topOffset,
  voiceEnabled,
  onToggleVoice,
  onRecenter,
  onOpenOrderDetails,
  stage,
  destination,
  destinationAddress,
}: Props) {
  return (
    <View
      style={{
        position: "absolute",
        right: 14,
        top: topOffset,
        alignItems: "center",
      }}
    >
      <TouchableOpacity
        onPress={onRecenter}
        activeOpacity={0.86}
        style={controlStyle("#FFFFFF")}
      >
        <Text style={{ color: "#020617", fontSize: 22, fontWeight: "900" }}>⌖</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={onToggleVoice}
        activeOpacity={0.86}
        style={controlStyle(voiceEnabled ? "rgba(2,6,23,0.92)" : "rgba(127,29,29,0.92)")}
      >
        <Text style={{ color: "#FFFFFF", fontSize: 20, fontWeight: "900" }}>
          {voiceEnabled ? "🔊" : "🔇"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() =>
          showExternalNavigationSheet({ stage, destination, destinationAddress })
        }
        activeOpacity={0.86}
        style={controlStyle("rgba(2,6,23,0.92)")}
      >
        <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "900" }}>↗</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={onOpenOrderDetails}
        activeOpacity={0.86}
        style={controlStyle("rgba(2,6,23,0.92)")}
      >
        <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "900" }}>☰</Text>
      </TouchableOpacity>
    </View>
  );
}

function controlStyle(backgroundColor: string) {
  return {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.22)",
    marginBottom: 10,
  };
}
