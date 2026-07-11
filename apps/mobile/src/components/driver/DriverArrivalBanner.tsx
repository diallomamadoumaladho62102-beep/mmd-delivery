import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import type { NavigationStage } from "../../lib/driverNavigation/types";

type Props = {
  visible: boolean;
  stage: NavigationStage;
  address: string;
  onOpenOrderDetails: () => void;
  /** Distance from the bottom (above the trip bar + home indicator). */
  bottomOffset?: number;
};

export function DriverArrivalBanner({
  visible,
  stage,
  address,
  onOpenOrderDetails,
  bottomOffset = 108,
}: Props) {
  if (!visible) return null;

  const title =
    stage === "pickup"
      ? "Arrivée au pickup"
      : "Arrivée au dropoff";

  const body =
    stage === "pickup"
      ? "Ouvre les détails de commande pour confirmer la collecte."
      : "Ouvre les détails de commande pour finaliser la livraison.";

  return (
    <View
      style={{
        position: "absolute",
        left: 14,
        right: 14,
        bottom: bottomOffset,
        zIndex: 28,
        borderRadius: 18,
        paddingHorizontal: 12,
        paddingTop: 10,
        paddingBottom: 10,
        backgroundColor: "rgba(5,46,22,0.96)",
        borderWidth: 1,
        borderColor: "rgba(34,197,94,0.45)",
        shadowColor: "#000",
        shadowOpacity: 0.2,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 5,
      }}
    >
      <Text style={{ color: "#86EFAC", fontSize: 11, fontWeight: "900" }}>
        {title}
      </Text>
      <Text
        style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "900", marginTop: 2 }}
        numberOfLines={1}
      >
        {address}
      </Text>
      <Text
        style={{ color: "#BBF7D0", fontSize: 11, marginTop: 4 }}
        numberOfLines={1}
      >
        {body}
      </Text>
      <TouchableOpacity
        onPress={onOpenOrderDetails}
        activeOpacity={0.88}
        style={{
          marginTop: 8,
          borderRadius: 999,
          paddingVertical: 10,
          alignItems: "center",
          backgroundColor: "#22C55E",
        }}
      >
        <Text style={{ color: "#052E16", fontSize: 13, fontWeight: "900" }}>
          Ouvrir les détails
        </Text>
      </TouchableOpacity>
    </View>
  );
}
