import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import type { NavigationStage } from "../../lib/driverNavigation/types";

type Props = {
  visible: boolean;
  stage: NavigationStage;
  address: string;
  onOpenOrderDetails: () => void;
};

export function DriverArrivalBanner({
  visible,
  stage,
  address,
  onOpenOrderDetails,
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
        bottom: 120,
        borderRadius: 22,
        padding: 14,
        backgroundColor: "rgba(5,46,22,0.96)",
        borderWidth: 1,
        borderColor: "rgba(34,197,94,0.45)",
      }}
    >
      <Text style={{ color: "#86EFAC", fontSize: 12, fontWeight: "900" }}>
        {title}
      </Text>
      <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "900", marginTop: 4 }}>
        {address}
      </Text>
      <Text style={{ color: "#BBF7D0", fontSize: 12, marginTop: 6 }}>
        {body}
      </Text>
      <TouchableOpacity
        onPress={onOpenOrderDetails}
        activeOpacity={0.88}
        style={{
          marginTop: 12,
          borderRadius: 999,
          paddingVertical: 12,
          alignItems: "center",
          backgroundColor: "#22C55E",
        }}
      >
        <Text style={{ color: "#052E16", fontSize: 14, fontWeight: "900" }}>
          Ouvrir les détails
        </Text>
      </TouchableOpacity>
    </View>
  );
}
