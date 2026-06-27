import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import type { NavigationStage } from "../../lib/driverNavigation/types";

type Props = {
  visible: boolean;
  stage: NavigationStage;
  onOpenOrderDetails: () => void;
};

export function DriverNavigationArrivalToast({
  visible,
  stage,
  onOpenOrderDetails,
}: Props) {
  if (!visible) return null;

  const message =
    stage === "pickup"
      ? "Arrivée au point de collecte"
      : "Arrivée au point de livraison";

  return (
    <TouchableOpacity
      onPress={onOpenOrderDetails}
      activeOpacity={0.9}
      style={{
        position: "absolute",
        left: 14,
        right: 14,
        bottom: 118,
        zIndex: 28,
        borderRadius: 999,
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: "rgba(0,0,0,0.92)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.1)",
      }}
    >
      <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "800" }}>
        {message}
      </Text>
    </TouchableOpacity>
  );
}
